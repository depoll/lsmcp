import {
  WorkspaceEdit,
  CodeAction,
  CodeActionKind,
  DocumentFormattingParams,
  FormattingOptions,
  RenameParams,
  CodeActionParams,
  Diagnostic,
  Command,
} from 'vscode-languageserver-protocol';
import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { createPositionSchema } from './position-schema.js';
import { FILE_URI_DESCRIPTION } from './file-uri-description.js';
import { getLanguageFromUri } from '../utils/languages.js';
import { EditTransactionManager, TransactionOptions } from './transactions.js';
import type { LSPClientV2 } from '../lsp/client-v2.js';
import { MCPError, MCPErrorCode } from './common-types.js';

// Sub-schemas for better organization and readability
const CodeActionParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  diagnostic: z
    .object({
      code: z.string().optional(),
      message: z.string(),
      range: z.object({
        start: createPositionSchema(),
        end: createPositionSchema(),
      }),
    })
    .optional()
    .describe('Diagnostic to match for code actions'),
  actionKind: z
    .enum(['quickfix', 'refactor', 'source'])
    .optional()
    .describe('Filter code actions by kind'),
  position: createPositionSchema().optional().describe('Position for context-aware code actions'),
  selectionStrategy: z.enum(['first', 'preferred', 'all', 'best-match']).default('first').optional()
    .describe(`Strategy for selecting from multiple available code actions:
• first: Apply the first available action (default, fastest)
• preferred: Select action matching preferredKinds order
• all: Apply multiple actions (limited by maxActions)
• best-match: Select action that specifically fixes the provided diagnostic`),
  preferredKinds: z
    .array(z.string())
    .optional()
    .describe(
      'Ordered list of preferred action kinds for "preferred" strategy. Common kinds: "quickfix", "refactor.extract", "refactor.inline", "source.fixAll"'
    ),
  maxActions: z
    .number()
    .min(1)
    .max(10)
    .default(5)
    .optional()
    .describe(
      'Safety limit: maximum actions to apply with "all" strategy (prevents runaway changes)'
    ),
});

const RenameParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: createPositionSchema().describe(
    'Zero-based position of the symbol to rename. Must point to a character within the symbol name. ' +
      'Line 0 = first line, character 0 = first character. Most editors show line 1 for the first line, ' +
      'so subtract 1 from editor line numbers. Example: To rename a symbol on editor line 22, use line: 21'
  ),
  newName: z.string().describe('New name for the symbol'),
  maxFiles: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .optional()
    .describe('Maximum number of files to modify (safety limit)'),
  excludePatterns: z
    .array(z.string())
    .optional()
    .describe('Glob patterns to exclude from rename (e.g., node_modules)'),
});

const FormatParamsSchema = z.object({
  uris: z
    .array(z.string())
    .describe('File URIs to format')
    .or(z.string().describe('Single file URI to format')),
  range: z
    .object({
      start: createPositionSchema(),
      end: createPositionSchema(),
    })
    .optional()
    .describe('Range to format (if omitted, formats entire file)'),
  options: z
    .object({
      tabSize: z.number().optional(),
      insertSpaces: z.boolean().optional(),
      trimTrailingWhitespace: z.boolean().optional(),
      insertFinalNewline: z.boolean().optional(),
      trimFinalNewlines: z.boolean().optional(),
    })
    .optional()
    .describe('Formatting options'),
});

const ApplyEditParamsSchema = z.object({
  type: z.enum(['codeAction', 'rename', 'format', 'organizeImports'])
    .describe(`Type of edit operation to perform:
• codeAction: Apply fixes, refactors, or source actions (e.g., fix errors, extract method)
• rename: Rename symbols across the codebase (variables, functions, classes)
• format: Format code according to language rules
• organizeImports: Sort and optimize import statements`),

  batch: z
    .boolean()
    .optional()
    .describe('Whether to perform multiple operations in a single transaction'),

  actions: z
    .array(CodeActionParamsSchema)
    .optional()
    .describe('Parameters for code action operations'),

  rename: RenameParamsSchema.optional().describe('Parameters for rename operations'),

  format: FormatParamsSchema.optional().describe('Parameters for format operations'),

  dryRun: z
    .boolean()
    .default(false)
    .optional()
    .describe('Preview mode: analyze what changes would be made without applying them'),

  atomic: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Transaction mode: if any edit fails, automatically rollback all changes (default: true for safety)'
    ),
});

type ApplyEditParams = z.infer<typeof ApplyEditParamsSchema>;

export interface ApplyEditResult {
  success: boolean;
  transactionId?: string;
  filesModified?: number;
  totalChanges?: number;
  changes?: Array<{
    uri: string;
    edits: number;
    preview?: string;
  }>;
  error?: MCPError;
  duration?: number;
  rollbackPerformed?: boolean;
  rollbackReason?: string;
}

export class ApplyEditTool extends BatchableTool<ApplyEditParams, ApplyEditResult> {
  readonly name = 'applyEdit';
  readonly description = `Apply code modifications via LSP with automatic rollback on failure.
Supports code actions (quickfixes, refactors), symbol renaming, code formatting,
and import organization. All operations are transactional - if any part fails,
all changes are rolled back to maintain consistency.`;
  readonly inputSchema = ApplyEditParamsSchema;

  private transactionManager: EditTransactionManager;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
    this.transactionManager = new EditTransactionManager();
  }

  async execute(params: ApplyEditParams): Promise<ApplyEditResult> {
    const validatedParams = this.validateParams(params);
    const startTime = Date.now();

    try {
      let edits: WorkspaceEdit[] = [];

      switch (validatedParams.type) {
        case 'codeAction':
          edits = await this.executeCodeActions(validatedParams);
          break;
        case 'rename':
          edits = await this.executeRename(validatedParams);
          break;
        case 'format':
          edits = await this.executeFormat(validatedParams);
          break;
        case 'organizeImports':
          edits = await this.executeOrganizeImports(validatedParams);
          break;
      }

      if (validatedParams.dryRun) {
        return this.createDryRunResult(edits, Date.now() - startTime);
      }

      const transactionOptions: TransactionOptions = {
        atomic: validatedParams.atomic ?? true,
        dryRun: false,
      };

      const result = await this.transactionManager.executeTransaction(edits, transactionOptions);

      return {
        success: true,
        transactionId: result.transactionId,
        filesModified: result.filesModified,
        totalChanges: result.totalChanges,
        changes: result.changes,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error({ error, params: validatedParams }, 'Apply edit failed');
      const isTransactionError = error instanceof Error && error.name === 'TransactionError';
      return {
        success: false,
        error: {
          code: MCPErrorCode.NOT_SUPPORTED,
          message: error instanceof Error ? error.message : 'Apply edit failed',
          details: error,
        },
        duration: Date.now() - startTime,
        rollbackPerformed: isTransactionError && (validatedParams.atomic ?? true),
        rollbackReason: isTransactionError
          ? 'Transaction failed - all changes reverted'
          : undefined,
      };
    }
  }

  private async executeCodeActions(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.actions || params.actions.length === 0) {
      throw new Error('No code actions specified');
    }

    const edits: WorkspaceEdit[] = [];

    for (const action of params.actions) {
      const client = await this.getClient(action.uri);

      const codeActionParams: CodeActionParams = {
        textDocument: { uri: action.uri },
        range: action.diagnostic?.range || {
          start: action.position || { line: 0, character: 0 },
          end: action.position || { line: 0, character: 0 },
        },
        context: {
          diagnostics: action.diagnostic ? [action.diagnostic as Diagnostic] : [],
          only: action.actionKind ? [action.actionKind as CodeActionKind] : undefined,
        },
      };

      const codeActions = await client.sendRequest('textDocument/codeAction', codeActionParams);

      if (!Array.isArray(codeActions) || codeActions.length === 0) {
        this.logger.warn({ uri: action.uri }, 'No code actions available');
        continue;
      }

      // Select actions based on strategy
      const selectedActions = this.selectCodeActions(
        codeActions as (CodeAction | Command)[],
        action.selectionStrategy || 'first',
        {
          diagnostic: action.diagnostic as Diagnostic | undefined,
          preferredKinds: action.preferredKinds,
          maxActions: action.maxActions || 5,
        }
      );

      this.logger.info(
        {
          uri: action.uri,
          availableActions: codeActions.length,
          selectedActions: selectedActions.length,
          strategy: action.selectionStrategy || 'first',
          titles: selectedActions.map((a) => {
            if ('title' in a) return a.title;
            if ('command' in a) return (a as Command).command;
            return 'unknown';
          }),
        },
        'Selected code actions'
      );

      // Apply selected actions
      for (const selectedAction of selectedActions) {
        if ('edit' in selectedAction && selectedAction.edit) {
          edits.push(selectedAction.edit);
        } else if ('command' in selectedAction && selectedAction.command) {
          const commandResult = await client.sendRequest('workspace/executeCommand', {
            command: selectedAction.command,
            arguments: (selectedAction as Command).arguments,
          });

          if (commandResult && typeof commandResult === 'object' && 'edit' in commandResult) {
            const resultWithEdit = commandResult as { edit: WorkspaceEdit };
            edits.push(resultWithEdit.edit);
          }
        }
      }
    }

    return edits;
  }

  private selectCodeActions(
    actions: (CodeAction | Command)[],
    strategy: 'first' | 'preferred' | 'all' | 'best-match',
    options: {
      diagnostic?: Diagnostic;
      preferredKinds?: string[];
      maxActions: number;
    }
  ): (CodeAction | Command)[] {
    if (actions.length === 0) return [];

    const firstAction = actions[0];
    if (!firstAction) return [];

    switch (strategy) {
      case 'first':
        return [firstAction];

      case 'preferred':
        if (!options.preferredKinds || options.preferredKinds.length === 0) {
          return [firstAction];
        }
        // Try to find actions matching preferred kinds
        for (const preferredKind of options.preferredKinds) {
          const matchingAction = actions.find(
            (a) => 'kind' in a && a.kind && a.kind.startsWith(preferredKind)
          );
          if (matchingAction) {
            return [matchingAction];
          }
        }
        // Fallback to first action
        return [firstAction];

      case 'all':
        return actions.slice(0, options.maxActions);

      case 'best-match':
        if (options.diagnostic) {
          // Find actions that specifically address the diagnostic
          const diagnosticMatches = actions.filter((action) => {
            if ('diagnostics' in action && action.diagnostics) {
              return action.diagnostics.some(
                (d) =>
                  d.range.start.line === options.diagnostic!.range.start.line &&
                  d.range.start.character === options.diagnostic!.range.start.character &&
                  d.message === options.diagnostic!.message
              );
            }
            return false;
          });
          const firstMatch = diagnosticMatches[0];
          if (firstMatch) {
            return [firstMatch];
          }
        }
        // Fallback to first action
        return [firstAction];

      default:
        return [firstAction];
    }
  }

  private async executeRename(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.rename) {
      throw new Error('No rename parameters specified');
    }

    const { uri, position, newName } = params.rename;
    
    // Log the exact parameters received
    this.logger.info(
      { 
        uri, 
        position,
        newName,
        paramsRaw: JSON.stringify(params.rename)
      },
      'executeRename called with parameters'
    );
    
    const client = await this.getClient(uri);

    // Ensure the file is opened in the language server
    try {
      const fs = await import('fs/promises');
      const filePath = new URL(uri).pathname;
      const content = await fs.readFile(filePath, 'utf-8');
      const language = getLanguageFromUri(uri);

      // First close the file if it's already open to ensure clean state
      try {
        client.sendNotification('textDocument/didClose', {
          textDocument: { uri },
        });
        this.logger.debug({ uri }, 'Closed existing file in language server');
      } catch {
        // Ignore errors on close
      }

      // Now open it fresh
      client.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: language,
          version: 1,
          text: content,
        },
      });

      this.logger.debug({ uri, language, contentLength: content.length }, 'Opened file in language server for rename');
      
      // Give the language server a moment to process the file
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      this.logger.warn({ error, uri }, 'Could not open file in language server');
    }

    // Try prepareRename first, but don't fail if it's not supported
    try {
      const prepareResult = await client.sendRequest('textDocument/prepareRename', {
        textDocument: { uri },
        position,
      });

      if (!prepareResult) {
        this.logger.warn(
          { uri, position },
          'prepareRename returned null - position may not contain a renameable symbol'
        );
        throw new Error(
          'Cannot rename at this location. Ensure the position points to a symbol (not whitespace or comments). ' +
            `Current position: line ${position.line + 1}, character ${position.character + 1}`
        );
      }

      this.logger.debug({ prepareResult }, 'prepareRename successful');
    } catch (error) {
      // Log the error but continue - some language servers may not support prepareRename
      this.logger.debug(
        { error, uri, position },
        'prepareRename failed or not supported, proceeding with rename anyway'
      );
    }

    const renameParams: RenameParams = {
      textDocument: { uri },
      position,
      newName,
    };

    this.logger.debug(
      { uri, position, newName },
      'Sending rename request'
    );

    const renameResult = await client.sendRequest('textDocument/rename', renameParams);

    if (!renameResult) {
      throw new Error('Rename failed - no edits returned');
    }

    return [renameResult];
  }

  private async executeFormat(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.format) {
      throw new Error('No format parameters specified');
    }

    const uris = Array.isArray(params.format.uris) ? params.format.uris : [params.format.uris];
    const edits: WorkspaceEdit[] = [];

    for (const uri of uris) {
      const client = await this.getClient(uri);

      const formattingParams: DocumentFormattingParams = {
        textDocument: { uri },
        options: (params.format.options as FormattingOptions) || {
          tabSize: 2,
          insertSpaces: true,
        },
      };

      const textEdits = await client.sendRequest('textDocument/formatting', formattingParams);

      if (textEdits && Array.isArray(textEdits) && textEdits.length > 0) {
        edits.push({
          documentChanges: [
            {
              textDocument: { uri, version: null },
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              edits: textEdits,
            },
          ],
        });
      }
    }

    return edits;
  }

  private async executeOrganizeImports(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    const edits: WorkspaceEdit[] = [];

    const uris = params.format?.uris
      ? Array.isArray(params.format.uris)
        ? params.format.uris
        : [params.format.uris]
      : [];

    if (uris.length === 0) {
      throw new Error('No files specified for organize imports');
    }

    for (const uri of uris) {
      const organizeAction: ApplyEditParams = {
        type: 'codeAction',
        actions: [
          {
            uri,
            actionKind: 'source',
            position: { line: 0, character: 0 },
          },
        ],
      };

      const actionEdits = await this.executeCodeActions(organizeAction);
      edits.push(...actionEdits);
    }

    return edits;
  }

  private createDryRunResult(edits: WorkspaceEdit[], duration: number): ApplyEditResult {
    let filesModified = 0;
    let totalChanges = 0;
    const changes: ApplyEditResult['changes'] = [];

    for (const edit of edits) {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            filesModified++;
            const editCount = change.edits.length;
            totalChanges += editCount;
            changes.push({
              uri: change.textDocument.uri,
              edits: editCount,
            });
          }
        }
      } else if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          filesModified++;
          totalChanges += textEdits.length;
          changes.push({
            uri,
            edits: textEdits.length,
          });
        }
      }
    }

    return {
      success: true,
      filesModified,
      totalChanges,
      changes,
      duration,
    };
  }

  private async getClient(uri: string): Promise<LSPClientV2> {
    const language = getLanguageFromUri(uri);
    const workspace = this.extractWorkspaceFromUri(uri);
    const client = await this.clientManager.get(language, workspace);

    if (!client) {
      throw new Error(`No language server available for ${language}`);
    }

    return client;
  }

  private extractWorkspaceFromUri(uri: string): string {
    try {
      const url = new URL(uri);
      const filePath = decodeURIComponent(url.pathname);
      const parts = filePath.split('/');

      // Find common workspace patterns
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (!part) continue;

        if (part === 'src' || part === 'lib' || part === 'test') {
          return parts.slice(0, i).join('/') || '/';
        }
        if (part.endsWith('.git')) {
          return parts.slice(0, i).join('/') || '/';
        }
      }

      // Default to parent directory of the file
      return parts.slice(0, -1).join('/') || '/';
    } catch {
      // Fallback for invalid URIs
      return process.cwd();
    }
  }
}
