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
  TextEdit,
  Range,
  CreateFile,
  DeleteFile,
  RenameFile,
  TextDocumentEdit,
} from 'vscode-languageserver-protocol';
import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { createPositionSchema } from './position-schema.js';
import { FILE_URI_DESCRIPTION } from './file-uri-description.js';
import { getLanguageFromUri } from '../utils/languages.js';
import { EditTransactionManager, TransactionOptions } from './transactions.js';
import type { LSPClient } from '../lsp/client-v2.js';
import { MCPError, MCPErrorCode } from './common-types.js';
import { readFile } from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

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

const TextEditParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  edits: z
    .array(
      z.object({
        range: z.object({
          start: createPositionSchema(),
          end: createPositionSchema(),
        }),
        newText: z.string().describe('Replacement text (empty string for deletion)'),
      })
    )
    .describe('Text edits to apply to the document'),
});

const MultiFileEditParamsSchema = z.object({
  edits: z.array(TextEditParamsSchema).describe('Text edits to apply across multiple files'),
});

const SearchReplaceParamsSchema = z.object({
  pattern: z.string().describe('Search pattern (supports regex when prefixed with /)'),
  replacement: z.string().describe('Replacement text (supports $1, $2 for regex groups)'),
  scope: z.enum(['file', 'directory', 'workspace']).describe('Scope of the search'),
  uri: z.string().optional().describe('File URI for file scope, directory URI for directory scope'),
  filePattern: z.string().optional().describe('Glob pattern to filter files (e.g., **/*.ts)'),
  excludePatterns: z.array(z.string()).optional().describe('Glob patterns to exclude'),
  caseSensitive: z.boolean().default(true).optional().describe('Case sensitive search'),
  wholeWord: z.boolean().default(false).optional().describe('Match whole words only'),
  maxReplacements: z
    .number()
    .min(1)
    .default(1000)
    .optional()
    .describe('Maximum replacements (safety limit)'),
});

const FileOperationParamsSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('create'),
          uri: z.string().describe('File URI to create'),
          content: z.string().optional().describe('Initial file content'),
          overwrite: z.boolean().default(false).optional(),
        }),
        z.object({
          type: z.literal('delete'),
          uri: z.string().describe('File URI to delete'),
          recursive: z.boolean().default(false).optional(),
          ignoreIfNotExists: z.boolean().default(false).optional(),
        }),
        z.object({
          type: z.literal('rename'),
          oldUri: z.string().describe('Current file URI'),
          newUri: z.string().describe('New file URI'),
          overwrite: z.boolean().default(false).optional(),
        }),
      ])
    )
    .describe('File operations to perform'),
});

const SmartInsertParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  insertions: z
    .array(
      z.object({
        type: z.enum(['import', 'method', 'property', 'comment']).describe('Type of insertion'),
        content: z.string().describe('Content to insert'),
        className: z
          .string()
          .optional()
          .describe('Target class name for method/property insertions'),
        preferredLocation: z
          .enum(['top', 'bottom', 'beforeClass', 'afterImports', 'insideClass'])
          .optional()
          .describe('Preferred insertion location'),
        sortOrder: z.enum(['alphabetical', 'dependency', 'none']).default('none').optional(),
      })
    )
    .describe('Smart insertions to perform'),
});

const BatchOperationSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('codeAction'),
          actions: z.array(CodeActionParamsSchema),
        }),
        z.object({
          type: z.literal('rename'),
          rename: RenameParamsSchema,
        }),
        z.object({
          type: z.literal('format'),
          format: FormatParamsSchema,
        }),
        z.object({
          type: z.literal('organizeImports'),
          format: FormatParamsSchema.optional(),
        }),
        z.object({
          type: z.literal('textEdit'),
          textEdit: TextEditParamsSchema,
        }),
        z.object({
          type: z.literal('multiFileEdit'),
          multiFileEdit: MultiFileEditParamsSchema,
        }),
        z.object({
          type: z.literal('searchReplace'),
          searchReplace: SearchReplaceParamsSchema,
        }),
        z.object({
          type: z.literal('fileOperation'),
          fileOperation: FileOperationParamsSchema,
        }),
        z.object({
          type: z.literal('smartInsert'),
          smartInsert: SmartInsertParamsSchema,
        }),
      ])
    )
    .describe('List of operations to execute in sequence'),
});

const ApplyEditParamsSchema = z.object({
  type: z.enum([
    'codeAction',
    'rename',
    'format',
    'organizeImports',
    'textEdit',
    'multiFileEdit',
    'searchReplace',
    'fileOperation',
    'smartInsert',
    'batch',
  ]).describe(`Type of edit operation to perform:
• codeAction: Apply fixes, refactors, or source actions (e.g., fix errors, extract method)
• rename: Rename symbols across the codebase (variables, functions, classes)
• format: Format code according to language rules
• organizeImports: Sort and optimize import statements
• textEdit: Apply direct text edits to a single file
• multiFileEdit: Apply text edits across multiple files
• searchReplace: Search and replace text across files
• fileOperation: Create, delete, or rename files
• smartInsert: Context-aware insertions (imports, methods, etc.)
• batch: Execute multiple operations in a single transaction`),

  actions: z
    .array(CodeActionParamsSchema)
    .optional()
    .describe('Parameters for code action operations'),

  rename: RenameParamsSchema.optional().describe('Parameters for rename operations'),

  format: FormatParamsSchema.optional().describe('Parameters for format operations'),

  textEdit: TextEditParamsSchema.optional().describe('Parameters for direct text edit operations'),

  multiFileEdit: MultiFileEditParamsSchema.optional().describe(
    'Parameters for multi-file text edit operations'
  ),

  batchOperations: BatchOperationSchema.optional().describe('Parameters for batch operations'),

  searchReplace: SearchReplaceParamsSchema.optional().describe(
    'Parameters for search and replace operations'
  ),

  fileOperation: FileOperationParamsSchema.optional().describe('Parameters for file operations'),

  smartInsert: SmartInsertParamsSchema.optional().describe(
    'Parameters for smart insert operations'
  ),

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
Supports code actions, symbol renaming, formatting, text editing, search/replace,
file operations, and smart insertions. All operations are transactional - if any
part fails, all changes are rolled back to maintain consistency.`;
  readonly inputSchema = ApplyEditParamsSchema;

  private transactionManager: EditTransactionManager;
  private readFileFn: typeof readFile;

  constructor(clientManager: ConnectionPool, readFileFn?: typeof readFile) {
    super(clientManager);
    this.transactionManager = new EditTransactionManager();
    this.readFileFn = readFileFn || readFile;
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
        case 'textEdit':
          edits = this.executeTextEdit(validatedParams);
          break;
        case 'multiFileEdit':
          edits = this.executeMultiFileEdit(validatedParams);
          break;
        case 'searchReplace':
          edits = await this.executeSearchReplace(validatedParams);
          break;
        case 'fileOperation':
          edits = this.executeFileOperations(validatedParams);
          break;
        case 'smartInsert':
          edits = await this.executeSmartInsert(validatedParams);
          break;
        case 'batch':
          edits = await this.executeBatchOperations(validatedParams);
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
        paramsRaw: JSON.stringify(params.rename),
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

      this.logger.debug(
        { uri, language, contentLength: content.length },
        'Opened file in language server for rename'
      );

      // Give the language server a moment to process the file
      await new Promise((resolve) => setTimeout(resolve, 200));
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

    this.logger.debug({ uri, position, newName }, 'Sending rename request');

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

  private executeTextEdit(params: ApplyEditParams): WorkspaceEdit[] {
    if (!params.textEdit) {
      throw new Error('No text edit parameters specified');
    }

    const { uri, edits } = params.textEdit;

    // Convert our edit format to LSP TextEdit format
    const textEdits: TextEdit[] = edits.map((edit) => ({
      range: edit.range as Range,
      newText: edit.newText,
    }));

    // Create a WorkspaceEdit with the text edits
    const workspaceEdit: WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: { uri, version: null },
          edits: textEdits,
        },
      ],
    };

    return [workspaceEdit];
  }

  private executeMultiFileEdit(params: ApplyEditParams): WorkspaceEdit[] {
    if (!params.multiFileEdit) {
      throw new Error('No multi-file edit parameters specified');
    }

    const { edits } = params.multiFileEdit;

    // Create a single WorkspaceEdit with all file changes
    const documentChanges = edits.map((fileEdit) => ({
      textDocument: { uri: fileEdit.uri, version: null },
      edits: fileEdit.edits.map((edit) => ({
        range: edit.range as Range,
        newText: edit.newText,
      })),
    }));

    const workspaceEdit: WorkspaceEdit = {
      documentChanges,
    };

    return [workspaceEdit];
  }

  private async executeSearchReplace(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.searchReplace) {
      throw new Error('No search replace parameters specified');
    }

    const {
      pattern,
      replacement,
      scope,
      uri,
      filePattern,
      excludePatterns,
      caseSensitive,
      wholeWord,
    } = params.searchReplace;

    // Create regex from pattern
    let regex: RegExp;
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      // Parse regex pattern
      const lastSlash = pattern.lastIndexOf('/');
      const regexPattern = pattern.slice(1, lastSlash);
      const flags = pattern.slice(lastSlash + 1);
      regex = new RegExp(regexPattern, flags + (caseSensitive ? '' : 'i'));
    } else {
      // Escape special regex characters for literal search
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordBoundary = wholeWord ? '\\b' : '';
      regex = new RegExp(
        `${wordBoundary}${escapedPattern}${wordBoundary}`,
        caseSensitive ? 'g' : 'gi'
      );
    }

    // Determine files to search
    let filesToSearch: string[] = [];

    if (scope === 'file') {
      if (!uri) throw new Error('URI required for file scope');
      filesToSearch = [new URL(uri).pathname];
    } else {
      // Get base directory
      const baseDir = scope === 'directory' && uri ? new URL(uri).pathname : process.cwd();

      // Apply file pattern
      const globPattern = filePattern || '**/*';
      const fullPattern = path.join(baseDir, globPattern);

      filesToSearch = await glob(fullPattern, {
        ignore: excludePatterns || ['**/node_modules/**', '**/.git/**'],
        nodir: true,
      });
    }

    // Collect all edits
    const documentChanges: Array<{
      textDocument: { uri: string; version: null };
      edits: TextEdit[];
    }> = [];
    let totalReplacements = 0;
    const maxReplacements = params.searchReplace.maxReplacements || 1000;

    for (const filePath of filesToSearch) {
      try {
        const content = await this.readFileFn(filePath, 'utf-8');
        const lines = content.split('\n');
        const edits: TextEdit[] = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          if (!line) continue;

          let match: RegExpExecArray | null;

          regex.lastIndex = 0; // Reset regex state
          while ((match = regex.exec(line)) !== null && totalReplacements < maxReplacements) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;

            // Apply replacement (handle regex groups)
            const newText = replacement.replace(/\$(\d+)/g, (_, group) => {
              const groupIndex = parseInt(group as string);
              return (match && match[groupIndex]) || '';
            });

            edits.push({
              range: {
                start: { line: lineIndex, character: startChar },
                end: { line: lineIndex, character: endChar },
              },
              newText,
            });

            totalReplacements++;

            // Prevent infinite loop for zero-width matches
            if (match[0].length === 0) {
              regex.lastIndex++;
            }

            if (!regex.global) break;
          }
        }

        if (edits.length > 0) {
          documentChanges.push({
            textDocument: {
              uri: `file://${filePath}`,
              version: null,
            },
            edits,
          });
        }
      } catch (error) {
        this.logger.warn({ error, filePath }, 'Failed to process file for search/replace');
      }
    }

    if (documentChanges.length === 0) {
      return [];
    }

    return [{ documentChanges }];
  }

  private executeFileOperations(params: ApplyEditParams): WorkspaceEdit[] {
    if (!params.fileOperation) {
      throw new Error('No file operation parameters specified');
    }

    const { operations } = params.fileOperation;
    const documentChanges: Array<CreateFile | DeleteFile | RenameFile | TextDocumentEdit> = [];

    for (const operation of operations) {
      switch (operation.type) {
        case 'create': {
          const createOp: CreateFile = {
            kind: 'create',
            uri: operation.uri,
            options: {
              overwrite: operation.overwrite,
              ignoreIfExists: !operation.overwrite,
            },
          };
          documentChanges.push(createOp);

          // If content is provided, add it as a text edit
          if (operation.content) {
            documentChanges.push({
              textDocument: { uri: operation.uri, version: null },
              edits: [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                  },
                  newText: operation.content,
                },
              ],
            } as TextDocumentEdit);
          }
          break;
        }

        case 'delete': {
          const deleteOp: DeleteFile = {
            kind: 'delete',
            uri: operation.uri,
            options: {
              recursive: operation.recursive,
              ignoreIfNotExists: operation.ignoreIfNotExists,
            },
          };
          documentChanges.push(deleteOp);
          break;
        }

        case 'rename': {
          const renameOp: RenameFile = {
            kind: 'rename',
            oldUri: operation.oldUri,
            newUri: operation.newUri,
            options: {
              overwrite: operation.overwrite,
              ignoreIfExists: !operation.overwrite,
            },
          };
          documentChanges.push(renameOp);
          break;
        }
      }
    }

    return [{ documentChanges }];
  }

  private async executeSmartInsert(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.smartInsert) {
      throw new Error('No smart insert parameters specified');
    }

    const { uri, insertions } = params.smartInsert;
    const filePath = new URL(uri).pathname;
    const content = await this.readFileFn(filePath, 'utf-8');
    const lines = content.split('\n');

    const edits: TextEdit[] = [];

    for (const insertion of insertions) {
      switch (insertion.type) {
        case 'import': {
          const importEdit = this.createImportEdit(lines, insertion.content, insertion.sortOrder);
          if (importEdit) edits.push(importEdit);
          break;
        }

        case 'method':
        case 'property': {
          const classEdit = this.createClassMemberEdit(
            lines,
            insertion.content,
            insertion.className || '',
            insertion.type,
            insertion.preferredLocation
          );
          if (classEdit) edits.push(classEdit);
          break;
        }

        case 'comment': {
          const commentEdit = this.createCommentEdit(
            lines,
            insertion.content,
            insertion.preferredLocation || 'top'
          );
          if (commentEdit) edits.push(commentEdit);
          break;
        }
      }
    }

    if (edits.length === 0) {
      return [];
    }

    return [
      {
        documentChanges: [
          {
            textDocument: { uri, version: null },
            edits,
          },
        ],
      },
    ];
  }

  private createImportEdit(lines: string[], content: string, _sortOrder?: string): TextEdit | null {
    // Find the last import line
    let lastImportLine = -1;
    let firstImportLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (line && line.startsWith('import ')) {
        if (firstImportLine === -1) firstImportLine = i;
        lastImportLine = i;
      } else if (firstImportLine !== -1 && line && !line.startsWith('//')) {
        // Stop at first non-import, non-comment line
        break;
      }
    }

    const insertLine = lastImportLine >= 0 ? lastImportLine + 1 : 0;

    // Add proper formatting
    const formattedContent = content.trim();
    const newText = lastImportLine >= 0 ? `\n${formattedContent}` : `${formattedContent}\n`;

    return {
      range: {
        start: { line: insertLine, character: 0 },
        end: { line: insertLine, character: 0 },
      },
      newText,
    };
  }

  private createClassMemberEdit(
    lines: string[],
    content: string,
    className: string,
    memberType: 'method' | 'property',
    preferredLocation?: string
  ): TextEdit | null {
    // Find the class
    let classStartLine = -1;
    let classEndLine = -1;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (classStartLine === -1) {
        // Look for class declaration
        const classMatch = line.match(
          new RegExp(`class\\s+${className}\\s*(?:extends|implements|{)`)
        );
        if (classMatch) {
          classStartLine = i;
          braceCount = 0;
        }
      }

      if (classStartLine !== -1) {
        // Count braces to find class end
        for (const char of line) {
          if (char === '{') braceCount++;
          else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              classEndLine = i;
              break;
            }
          }
        }
        if (classEndLine !== -1) break;
      }
    }

    if (classStartLine === -1 || classEndLine === -1) {
      return null;
    }

    // Determine insertion point
    let insertLine = classEndLine;
    if (preferredLocation === 'top' || memberType === 'property') {
      // Find first line after class opening brace
      for (let i = classStartLine; i < classEndLine; i++) {
        const currentLine = lines[i];
        if (currentLine && currentLine.includes('{')) {
          insertLine = i + 1;
          break;
        }
      }
    }

    // Get indentation from neighboring lines
    const indentMatch = lines[insertLine - 1]?.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] + '  ' : '  ';

    const formattedContent = content
      .split('\n')
      .map((line) => (line.trim() ? indent + line : line))
      .join('\n');

    return {
      range: {
        start: { line: insertLine, character: 0 },
        end: { line: insertLine, character: 0 },
      },
      newText: `${formattedContent}\n`,
    };
  }

  private createCommentEdit(lines: string[], content: string, location: string): TextEdit | null {
    let insertLine = 0;

    if (location === 'bottom') {
      insertLine = lines.length;
    }

    const formattedContent = content
      .split('\n')
      .map((line) => (line.trim() ? `// ${line}` : '//'))
      .join('\n');

    return {
      range: {
        start: { line: insertLine, character: 0 },
        end: { line: insertLine, character: 0 },
      },
      newText: location === 'bottom' ? `\n${formattedContent}` : `${formattedContent}\n`,
    };
  }

  private async executeBatchOperations(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
    if (!params.batchOperations) {
      throw new Error('No batch operations specified');
    }

    const { operations } = params.batchOperations;
    const allEdits: WorkspaceEdit[] = [];

    for (const operation of operations) {
      try {
        let edits: WorkspaceEdit[] = [];

        switch (operation.type) {
          case 'codeAction':
            edits = await this.executeCodeActions({
              type: 'codeAction',
              actions: operation.actions,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'rename':
            edits = await this.executeRename({
              type: 'rename',
              rename: operation.rename,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'format':
            edits = await this.executeFormat({
              type: 'format',
              format: operation.format,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'organizeImports':
            edits = await this.executeOrganizeImports({
              type: 'organizeImports',
              format: operation.format,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'textEdit':
            edits = this.executeTextEdit({
              type: 'textEdit',
              textEdit: operation.textEdit,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'multiFileEdit':
            edits = this.executeMultiFileEdit({
              type: 'multiFileEdit',
              multiFileEdit: operation.multiFileEdit,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'searchReplace':
            edits = await this.executeSearchReplace({
              type: 'searchReplace',
              searchReplace: operation.searchReplace,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'fileOperation':
            edits = this.executeFileOperations({
              type: 'fileOperation',
              fileOperation: operation.fileOperation,
              dryRun: false,
              atomic: false,
            });
            break;
          case 'smartInsert':
            edits = await this.executeSmartInsert({
              type: 'smartInsert',
              smartInsert: operation.smartInsert,
              dryRun: false,
              atomic: false,
            });
            break;
        }

        allEdits.push(...edits);
      } catch (error) {
        this.logger.error({ operation: operation.type, error }, 'Batch operation failed');
        throw new Error(
          `Batch operation '${operation.type}' failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    return allEdits;
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

  private async getClient(uri: string): Promise<LSPClient> {
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
