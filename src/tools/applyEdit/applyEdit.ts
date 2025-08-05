import { WorkspaceEdit } from 'vscode-languageserver-protocol';
import { BatchableTool } from '../base.js';
import { ConnectionPool } from '../../lsp/index.js';
import { getLanguageFromUri } from '../../utils/languages.js';
import { EditTransactionManager, TransactionOptions } from '../transactions.js';
import type { LSPClient } from '../../lsp/client-v2.js';
import { MCPError, MCPErrorCode } from '../common-types.js';
import { readFile } from 'fs/promises';
import { ApplyEditParamsSchema, type ApplyEditParams } from './schemas.js';
import {
  executeCodeActions,
  executeRename,
  executeFormat,
  executeOrganizeImports,
  executeTextEdit,
  executeMultiFileEdit,
  executeSearchReplace,
  executeFileOperations,
  executeSmartInsert,
  executeBatchOperations,
} from './executors/index.js';

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

      // Create a bound getClient function for executors
      const getClient = this.getClient.bind(this);

      switch (validatedParams.type) {
        case 'codeAction':
          edits = await executeCodeActions(validatedParams, getClient);
          break;

        case 'rename':
          edits = await executeRename(validatedParams, getClient);
          break;

        case 'format':
          edits = await executeFormat(validatedParams, getClient);
          break;

        case 'organizeImports':
          edits = await executeOrganizeImports(validatedParams, (params) =>
            executeCodeActions(params, getClient)
          );
          break;

        case 'textEdit':
          edits = executeTextEdit(validatedParams);
          break;

        case 'multiFileEdit':
          edits = executeMultiFileEdit(validatedParams);
          break;

        case 'searchReplace':
          edits = await executeSearchReplace(validatedParams);
          break;

        case 'fileOperation':
          edits = executeFileOperations(validatedParams);
          break;

        case 'smartInsert':
          edits = await executeSmartInsert(validatedParams, this.readFileFn);
          break;

        case 'batch':
          edits = await executeBatchOperations(validatedParams, getClient, this.readFileFn);
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
        success: result.success,
        transactionId: result.transactionId,
        filesModified: result.filesModified,
        totalChanges: result.totalChanges,
        changes: result.changes,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.message.includes('rollback')) {
        return {
          success: false,
          error: new MCPError(MCPErrorCode.InvalidRequest, error.message),
          duration,
          rollbackPerformed: true,
          rollbackReason: error.message,
        };
      }

      return {
        success: false,
        error:
          error instanceof MCPError
            ? error
            : new MCPError(
                MCPErrorCode.InternalError,
                error instanceof Error ? error.message : 'Unknown error'
              ),
        duration,
      };
    }
  }

  private validateParams(params: ApplyEditParams): ApplyEditParams {
    const result = this.inputSchema.safeParse(params);
    if (!result.success) {
      throw new MCPError(MCPErrorCode.InvalidParams, result.error.message);
    }
    return result.data;
  }

  private async getClient(uri: string): Promise<LSPClient> {
    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, uri);

    if (!client.isConnected()) {
      throw new MCPError(MCPErrorCode.InternalError, `Language server not connected for ${language}`);
    }

    return client;
  }

  private createDryRunResult(edits: WorkspaceEdit[], duration: number): ApplyEditResult {
    const changes: ApplyEditResult['changes'] = [];
    const affectedFiles = new Set<string>();

    for (const edit of edits) {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            affectedFiles.add(change.textDocument.uri);
            changes.push({
              uri: change.textDocument.uri,
              edits: change.edits.length,
              preview: this.generatePreview(change.edits),
            });
          } else if ('uri' in change) {
            affectedFiles.add(change.uri);
            changes.push({
              uri: change.uri,
              edits: 1,
              preview: `${change.kind} operation`,
            });
          } else if ('oldUri' in change) {
            affectedFiles.add(change.oldUri);
            affectedFiles.add(change.newUri);
            changes.push({
              uri: change.oldUri,
              edits: 1,
              preview: `Rename to ${change.newUri}`,
            });
          }
        }
      } else if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          affectedFiles.add(uri);
          changes.push({
            uri,
            edits: textEdits.length,
            preview: this.generatePreview(textEdits),
          });
        }
      }
    }

    return {
      success: true,
      filesModified: affectedFiles.size,
      totalChanges: changes.reduce((sum, c) => sum + c.edits, 0),
      changes,
      duration,
    };
  }

  private generatePreview(edits: any[]): string {
    if (edits.length === 0) return 'No changes';
    if (edits.length === 1) {
      const edit = edits[0];
      if (edit.newText.length < 100) {
        return edit.newText || '[deletion]';
      }
      return `${edit.newText.substring(0, 97)}...`;
    }
    return `${edits.length} edits`;
  }

  protected async executeBatch(
    operations: ApplyEditParams[]
  ): Promise<Array<ApplyEditResult | MCPError>> {
    return Promise.all(operations.map((op) => this.execute(op).catch((error) => error)));
  }
}