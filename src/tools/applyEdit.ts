import { WorkspaceEdit } from 'vscode-languageserver-protocol';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { getLanguageFromUri } from '../utils/languages.js';
import {
  MCPError,
  MCPErrorCode,
  StandardResult,
  rangeSchema,
  ToolAnnotations,
} from './common-types.js';
import { formatWorkspaceEditAsDiff, formatWorkspaceEditSummary } from '../utils/diff-formatter.js';
import { applyWorkspaceEdit } from '../utils/file-operations.js';
import { z } from 'zod';

// Comprehensive WorkspaceEdit schema definition following LSP specification
const TextEditSchema = z.object({
  range: rangeSchema.describe(
    'Range to replace. Lines/chars are 0-indexed. To insert: start=end. To delete: newText=""'
  ),
  newText: z.string().describe('Text to insert. Use \\n for newlines. Empty string to delete.'),
});

const TextDocumentEditSchema = z.object({
  textDocument: z.object({
    uri: z.string().describe('URI of the text document'),
    version: z.number().nullable().describe('Version of the text document'),
  }),
  edits: z.array(TextEditSchema).describe('Array of text edits to apply'),
});

const CreateFileSchema = z.object({
  kind: z.literal('create'),
  uri: z.string().describe('URI of the file to create'),
  options: z
    .object({
      overwrite: z.boolean().optional().describe('Overwrite existing file'),
      ignoreIfExists: z.boolean().optional().describe('Ignore if file already exists'),
    })
    .optional(),
});

const RenameFileSchema = z.object({
  kind: z.literal('rename'),
  oldUri: z.string().describe('URI of the file to rename'),
  newUri: z.string().describe('New URI for the file'),
  options: z
    .object({
      overwrite: z.boolean().optional().describe('Overwrite target if exists'),
      ignoreIfExists: z.boolean().optional().describe('Ignore if target exists'),
    })
    .optional(),
});

const DeleteFileSchema = z.object({
  kind: z.literal('delete'),
  uri: z.string().describe('URI of the file to delete'),
  options: z
    .object({
      recursive: z.boolean().optional().describe('Delete recursively'),
      ignoreIfNotExists: z.boolean().optional().describe('Ignore if file does not exist'),
    })
    .optional(),
});

const WorkspaceEditSchema = z.object({
  changes: z
    .record(z.string(), z.array(TextEditSchema))
    .optional()
    .describe('Map of URIs to text edits'),
  documentChanges: z
    .array(z.union([TextDocumentEditSchema, CreateFileSchema, RenameFileSchema, DeleteFileSchema]))
    .optional()
    .describe('Array of document changes to apply in order'),
  changeAnnotations: z
    .record(
      z.string(),
      z.object({
        label: z.string(),
        needsConfirmation: z.boolean().optional(),
        description: z.string().optional(),
      })
    )
    .optional()
    .describe('Map of change annotation identifiers to change annotations'),
});

const ApplyEditParamsSchema = z.object({
  edit: WorkspaceEditSchema.describe(
    'The workspace edit to apply. Use documentChanges for ordered operations (e.g., create then edit). ' +
      'Use changes for simple text edits to existing files.'
  ),
  label: z.string().optional().describe('Optional label to describe the edit operation'),
});

export type ApplyEditParams = z.infer<typeof ApplyEditParamsSchema>;

/**
 * Result data for applying a workspace edit
 */
export interface ApplyEditResultData {
  /** Whether the edit was successfully applied */
  applied: boolean;
  /** Reason for failure if applied is false */
  failureReason?: string;
  /** Specific change that failed (if available) */
  failedChange?: string;
  /** Human-readable summary of changes (e.g., "3 edits in 2 files") */
  summary: string;
  /** Formatted diff showing the changes made - display this to users */
  diff: string;
}

/**
 * Standard MCP result for apply edit operations
 */
export type ApplyEditResult = StandardResult<ApplyEditResultData>;

export class ApplyEditTool extends BatchableTool<ApplyEditParams, ApplyEditResult> {
  readonly name = 'applyEdit';
  readonly description =
    'Apply workspace edits to modify files with precise text changes, create/delete files, or rename files. ' +
    'Returns diff showing changes made. CAUTION: Makes destructive changes - review diff carefully.\n\n' +
    'LANGUAGE SUPPORT:\n' +
    '• Works with ANY file type - no language server required\n' +
    '• Gracefully handles files without LSP support (JSON, YAML, plain text, etc.)\n' +
    '• Language servers used when available for validation but not required\n\n' +
    'CRITICAL POSITIONING RULES:\n' +
    '• Lines are 0-indexed (first line = 0, second line = 1, etc.)\n' +
    '• Characters are 0-indexed within each line (first char = 0)\n' +
    '• To insert at line start: character = 0\n' +
    '• To insert at line end: character = line.length\n' +
    '• To replace entire line: start.character = 0, end.character = line.length\n' +
    '• To insert between lines: use end of previous line (line N, char = line.length)\n\n' +
    'FILE OPERATIONS ORDER:\n' +
    '• Always put create/rename/delete operations BEFORE text edits\n' +
    '• When creating file with content: 1) create file, 2) add text edit\n\n' +
    'COMMON MISTAKES TO AVOID:\n' +
    '• Using 1-based line numbers (use 0-based!)\n' +
    "• Trying to edit files that don't exist yet (create them first!)\n" +
    '• Overlapping text edits (edits must not overlap!)';
  readonly inputSchema = ApplyEditParamsSchema;

  /** Output schema for MCP tool discovery */
  readonly outputSchema = z.object({
    data: z.object({
      applied: z.boolean().describe('Whether the edit was successfully applied'),
      failureReason: z.string().optional().describe('Reason for failure if applied is false'),
      failedChange: z.string().optional().describe('Specific change that failed'),
      summary: z.string().describe('Human-readable summary of changes'),
      diff: z.string().describe('Formatted diff showing changes made'),
    }),
    metadata: z
      .object({
        processingTime: z.number().optional(),
        cached: z.boolean().optional(),
        total: z.number().optional(),
        truncated: z.boolean().optional(),
      })
      .optional(),
    fallback: z.string().optional().describe('Fallback suggestion if operation failed'),
    error: z.string().optional(),
  });

  /** MCP tool annotations */
  readonly annotations: ToolAnnotations = {
    title: 'Apply Workspace Edit',
    readOnlyHint: false,
    destructiveHint: true, // This modifies files
    idempotentHint: false, // Multiple applications could have different effects
    openWorldHint: false, // Operates on local workspace
  };

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: ApplyEditParams): Promise<ApplyEditResult> {
    const startTime = Date.now();

    try {
      const validatedParams = this.validateParams(params);

      // Validate workspace edit safety
      this.validateWorkspaceEditSafety(validatedParams.edit);

      // Check if this is a pure file operation that doesn't need a language server
      // OR if it starts with a create operation (file doesn't exist yet)
      const isPureFileOperation = this.isPureFileOperation(validatedParams.edit);
      const startsWithCreate = this.startsWithCreateOperation(validatedParams.edit);

      if (!isPureFileOperation && !startsWithCreate) {
        // Get the first URI from the edit to determine which LSP client to use
        const uri = this.getFirstUri(validatedParams.edit);
        if (!uri) {
          throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'No URIs found in workspace edit', {
            edit: validatedParams.edit,
          });
        }

        const language = getLanguageFromUri(uri);

        // Try to get a language server, but don't fail if unavailable
        // Many file types (JSON, YAML, plain text, etc.) don't have language servers
        // but we can still apply edits to them directly
        try {
          const client = await this.clientManager.get(language, uri);

          if (client && !client.isConnected()) {
            // Log warning but continue - we can still apply filesystem edits
            this.logger.warn(
              { language, uri },
              `Language server not connected for ${language}, continuing with direct file edit`
            );
          }
        } catch {
          // Language server not available - this is fine for many file types
          // Log for debugging but continue with the edit
          this.logger.debug(
            { language, uri },
            `No language server for ${language}, applying edit directly to filesystem`
          );
        }
      }

      // Generate summary before applying
      const summary = formatWorkspaceEditSummary(validatedParams.edit);

      // IMPORTANT: Generate diff BEFORE applying to capture original content
      // This ensures the diff shows the actual changes being made
      const diff = formatWorkspaceEditAsDiff(validatedParams.edit);

      // Apply the edit directly to the filesystem
      // Note: We don't send workspace/applyEdit to the server because that's a server-to-client request.
      // As the client, we apply the edits ourselves.
      const result = await applyWorkspaceEdit(validatedParams.edit);

      const processingTime = Date.now() - startTime;

      return {
        data: {
          applied: result.applied,
          failureReason: result.failureReason,
          failedChange: result.failedChange,
          summary,
          diff,
        },
        metadata: {
          processingTime,
          cached: false,
        },
        fallback: result.applied
          ? undefined
          : `Failed to apply edit. Consider using manual file editing tools instead.`,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      // Return error in StandardResult format
      return {
        data: {
          applied: false,
          failureReason: error instanceof Error ? error.message : String(error),
          summary: 'Failed to apply workspace edit',
          diff: '',
        },
        metadata: {
          processingTime,
          cached: false,
        },
        error: error instanceof Error ? error.message : String(error),
        fallback:
          'Consider using manual file editing tools or checking if the language server is running.',
      };
    }
  }

  /**
   * Validates that a workspace edit is safe to apply
   */
  private validateWorkspaceEditSafety(edit: WorkspaceEdit): void {
    const uris = this.getAllUris(edit);

    for (const uri of uris) {
      // Only allow file:// URIs for security
      if (!uri.startsWith('file://')) {
        throw new MCPError(
          MCPErrorCode.INVALID_PARAMS,
          `Unsupported URI scheme: ${uri}. Only file:// URIs are allowed.`,
          { uri }
        );
      }

      // Additional safety checks could be added here:
      // - Check for path traversal attempts
      // - Validate against allowed directories
      // - Check file size limits for edits
    }
  }

  /**
   * Extract all URIs from a workspace edit
   */
  private getAllUris(edit: WorkspaceEdit): string[] {
    const uris = new Set<string>();

    // Extract from changes map
    if (edit.changes) {
      Object.keys(edit.changes).forEach((uri) => uris.add(uri));
    }

    // Extract from document changes
    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if ('textDocument' in change) {
          uris.add(change.textDocument.uri);
        } else if ('uri' in change) {
          uris.add(change.uri);
        } else if ('oldUri' in change) {
          uris.add(change.oldUri);
          if ('newUri' in change) {
            uris.add(change.newUri);
          }
        }
      }
    }

    return Array.from(uris);
  }

  private getFirstUri(edit: WorkspaceEdit): string | undefined {
    // Check documentChanges first
    if (edit.documentChanges && edit.documentChanges.length > 0) {
      const firstChange = edit.documentChanges[0];
      if (firstChange && 'textDocument' in firstChange) {
        return firstChange.textDocument.uri;
      } else if (firstChange && 'uri' in firstChange) {
        return firstChange.uri;
      } else if (firstChange && 'oldUri' in firstChange) {
        return firstChange.oldUri;
      }
    }

    // Check changes map
    if (edit.changes) {
      const uris = Object.keys(edit.changes);
      if (uris.length > 0) {
        return uris[0];
      }
    }

    return undefined;
  }

  /**
   * Execute batch operations with improved grouping by language server
   */
  async executeBatch(operations: ApplyEditParams[]): Promise<ApplyEditResult[]> {
    // Group operations by language server for efficiency
    const grouped = this.groupByLanguageServer(operations);
    const results: ApplyEditResult[] = [];

    for (const [language, ops] of grouped) {
      this.logger.info({ language, count: ops.length }, 'Processing batch for language');

      // Process operations for this language server
      const batchResults = await Promise.all(
        ops.map(({ operation, originalIndex }) =>
          this.execute(operation).then((result) => ({ result, originalIndex }))
        )
      );

      // Store results in original order
      batchResults.forEach(({ result, originalIndex }) => {
        results[originalIndex] = result;
      });
    }

    return results;
  }

  /**
   * Group operations by the language server they'll use
   */
  private groupByLanguageServer(
    operations: ApplyEditParams[]
  ): Map<string, Array<{ operation: ApplyEditParams; originalIndex: number }>> {
    const grouped = new Map<string, Array<{ operation: ApplyEditParams; originalIndex: number }>>();

    operations.forEach((operation, index) => {
      const uri = this.getFirstUri(operation.edit);
      if (!uri) {
        // Handle operations with no URI separately
        const key = 'unknown';
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push({ operation, originalIndex: index });
        return;
      }

      const language = getLanguageFromUri(uri);
      if (!grouped.has(language)) {
        grouped.set(language, []);
      }
      grouped.get(language)!.push({ operation, originalIndex: index });
    });

    return grouped;
  }

  /**
   * Check if this is a pure file operation (create/delete/rename) without text edits
   */
  private isPureFileOperation(edit: WorkspaceEdit): boolean {
    // If there are simple changes, it's not a pure file operation
    if (edit.changes && Object.keys(edit.changes).length > 0) {
      return false;
    }

    // Check document changes
    if (!edit.documentChanges || edit.documentChanges.length === 0) {
      return false;
    }

    // Check if all changes are file operations (not text edits)
    return edit.documentChanges.every((change) => {
      // If it has 'kind', it's a file operation (create/delete/rename)
      // If it has 'textDocument', it's a text edit
      return 'kind' in change;
    });
  }

  /**
   * Check if the edit starts with a create operation (for files that don't exist yet)
   */
  private startsWithCreateOperation(edit: WorkspaceEdit): boolean {
    if (!edit.documentChanges || edit.documentChanges.length === 0) {
      return false;
    }

    const firstChange = edit.documentChanges[0];
    return Boolean(firstChange && 'kind' in firstChange && firstChange.kind === 'create');
  }
}
