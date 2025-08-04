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
  selectionStrategy: z
    .enum(['first', 'preferred', 'all', 'best-match'])
    .default('first')
    .optional()
    .describe(
      'How to select from multiple available actions: first (default), preferred (by kind), all (apply multiple), best-match (match diagnostics)'
    ),
  preferredKinds: z
    .array(z.string())
    .optional()
    .describe(
      'Preferred action kinds when using "preferred" strategy (e.g., ["quickfix", "refactor.extract"])'
    ),
  maxActions: z
    .number()
    .min(1)
    .max(10)
    .default(5)
    .optional()
    .describe('Maximum number of actions to apply when using "all" strategy'),
});

const RenameParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: createPositionSchema().describe('Position of symbol to rename'),
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
  type: z
    .enum(['codeAction', 'rename', 'format', 'organizeImports'])
    .describe('Type of edit operation to perform'),

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

  dryRun: z.boolean().default(false).optional().describe('Preview changes without applying them'),

  atomic: z
    .boolean()
    .default(true)
    .optional()
    .describe('Apply all edits atomically (rollback on any failure)'),
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
}

export class ApplyEditTool extends BatchableTool<ApplyEditParams, ApplyEditResult> {
  readonly name = 'applyEdit';
  readonly description = 'Apply code actions, renames, or formatting with rollback support';
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
      return {
        success: false,
        error: {
          code: MCPErrorCode.NOT_SUPPORTED,
          message: error instanceof Error ? error.message : 'Apply edit failed',
          details: error,
        },
        duration: Date.now() - startTime,
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
    const client = await this.getClient(uri);

    const prepareParams: RenameParams = {
      textDocument: { uri },
      position,
      newName,
    };

    const prepareResult = await client.sendRequest('textDocument/prepareRename', {
      textDocument: { uri },
      position,
    });

    if (!prepareResult) {
      throw new Error('Cannot rename at this location');
    }

    const renameResult = await client.sendRequest('textDocument/rename', prepareParams);

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
