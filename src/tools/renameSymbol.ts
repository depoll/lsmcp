import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { getLanguageFromUri } from '../utils/languages.js';
import {
  MCPError,
  MCPErrorCode,
  StandardResult,
  positionSchema,
  locationSchema,
} from './common-types.js';
import { formatWorkspaceEditAsDiff, formatWorkspaceEditSummary } from '../utils/diff-formatter.js';
import { applyWorkspaceEdit } from '../utils/file-operations.js';
import {
  WorkspaceEdit,
  RenameParams,
  PrepareRenameParams,
  Range,
  Position,
} from 'vscode-languageserver-protocol';

// Input schema for the rename symbol tool
const RenameSymbolParamsSchema = z
  .object({
    // Option 1: Use location from other tools (preferred)
    location: locationSchema
      .optional()
      .describe(
        'Location from findSymbols/navigate/findUsages. Takes precedence over uri/position.'
      ),

    // Option 2: Specify file and position explicitly
    uri: z
      .string()
      .optional()
      .describe('File URI containing the symbol. Required if location not provided.'),
    position: positionSchema
      .optional()
      .describe('Position of the symbol to rename. Required if location not provided.'),

    // New name for the symbol
    newName: z.string().describe('New name for the symbol'),
  })
  .refine((data) => data.location || (data.uri && data.position), {
    message: 'Either location or both uri and position must be provided',
  });

export type RenameSymbolParams = z.infer<typeof RenameSymbolParamsSchema>;

/**
 * Result data for renaming a symbol
 */
interface RenameSymbolData {
  /**
   * Summary of changes made
   */
  summary: string;

  /**
   * Detailed diff of all changes
   */
  diff: string;

  /**
   * Number of files modified
   */
  filesModified: number;

  /**
   * Number of occurrences replaced
   */
  occurrencesReplaced: number;

  /**
   * The original symbol name
   */
  originalName?: string;
}

/**
 * Tool for renaming symbols across the codebase using LSP textDocument/rename
 *
 * This tool provides reliable symbol renaming without requiring manual position
 * calculation. It automatically handles all occurrences of the symbol across files.
 */
export class RenameSymbolTool extends BatchableTool<
  RenameSymbolParams,
  StandardResult<RenameSymbolData>
> {
  readonly name = 'renameSymbol';
  readonly description = `Rename symbols across the codebase using semantic understanding.

Accepts Location objects directly from other tools (findSymbols, navigate, findUsages) 
or explicit uri/position. Automatically handles all occurrences.

Features:
- Direct location passing from other tools
- Semantic-aware renaming
- Cross-file support
- Validation before rename
- Automatic transaction handling

Examples:
1. Rename from symbol search:
   const symbols = await findSymbols({ query: "oldFunction" });
   await renameSymbol({ location: symbols[0].location, newName: "newFunction" });

2. Rename at specific position:
   await renameSymbol({ 
     uri: "file:///src/app.ts", 
     position: { line: 10, character: 5 }, 
     newName: "betterName" 
   });`;

  readonly inputSchema = RenameSymbolParamsSchema;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: RenameSymbolParams): Promise<StandardResult<RenameSymbolData>> {
    const validated = this.validateParams(params);

    // Extract uri and position from location or direct params
    let uri: string;
    let position: Position;

    if (validated.location) {
      uri = validated.location.uri;
      // Use the start position of the range
      position = validated.location.range.start;
    } else {
      uri = validated.uri!;
      position = validated.position!;
    }

    // Get the appropriate language server
    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, process.cwd());

    if (!client) {
      throw new MCPError(
        MCPErrorCode.InternalError,
        `No language server available for ${language || 'unknown language'}`
      );
    }

    try {
      // First, check if rename is supported at this position
      const prepareParams: PrepareRenameParams = {
        textDocument: { uri },
        position,
      };

      let originalName: string | undefined;
      let canRename = true;

      try {
        const prepareResult = await client.connection.sendRequest<
          Range | { range: Range; placeholder: string } | null
        >('textDocument/prepareRename', prepareParams);

        if (!prepareResult) {
          canRename = false;
        } else if ('placeholder' in prepareResult) {
          originalName = prepareResult.placeholder;
        }
      } catch (error) {
        // Some servers don't support prepareRename, continue anyway
        this.logger.debug('prepareRename not supported or failed, continuing with rename', {
          error,
        });
      }

      if (!canRename) {
        throw new MCPError(
          MCPErrorCode.InvalidRequest,
          'Cannot rename at this position - symbol may not be renameable'
        );
      }

      // Perform the rename
      const renameParams: RenameParams = {
        textDocument: { uri },
        position,
        newName: validated.newName,
      };

      const workspaceEdit = await client.connection.sendRequest<WorkspaceEdit | null>(
        'textDocument/rename',
        renameParams
      );

      if (!workspaceEdit) {
        throw new MCPError(
          MCPErrorCode.InternalError,
          'Language server returned no edits for rename operation'
        );
      }

      // Apply the workspace edit
      await applyWorkspaceEdit(workspaceEdit);

      // Format the results
      const summary = formatWorkspaceEditSummary(workspaceEdit);
      const diff = formatWorkspaceEditAsDiff(workspaceEdit);

      // Count files and occurrences
      let filesModified = 0;
      let occurrencesReplaced = 0;

      if (workspaceEdit.changes) {
        filesModified = Object.keys(workspaceEdit.changes).length;
        for (const edits of Object.values(workspaceEdit.changes)) {
          occurrencesReplaced += edits.length;
        }
      }

      if (workspaceEdit.documentChanges) {
        const uniqueFiles = new Set<string>();
        for (const change of workspaceEdit.documentChanges) {
          if ('textDocument' in change) {
            uniqueFiles.add(change.textDocument.uri);
            occurrencesReplaced += change.edits.length;
          }
        }
        filesModified = uniqueFiles.size;
      }

      const result: StandardResult<RenameSymbolData> = {
        data: {
          summary,
          diff,
          filesModified,
          occurrencesReplaced,
          originalName,
        },
        metadata: {
          processingTime: Date.now(),
          cached: false,
        },
      };

      return result;
    } catch (error) {
      if (error instanceof MCPError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for common errors
      if (errorMessage.includes('not supported')) {
        throw new MCPError(
          MCPErrorCode.NOT_SUPPORTED,
          'Rename operation not supported by this language server'
        );
      }

      throw new MCPError(MCPErrorCode.InternalError, `Failed to rename symbol: ${errorMessage}`);
    }
  }
}
