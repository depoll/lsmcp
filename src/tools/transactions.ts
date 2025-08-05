import {
  WorkspaceEdit,
  TextDocumentEdit,
  CreateFile,
  RenameFile,
  DeleteFile,
  ApplyWorkspaceEditResult,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, unlink, rename, stat } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger as baseLogger } from '../utils/logger.js';
import { validateFilePath } from '../utils/path-security.js';

const logger = baseLogger.child({ component: 'EditTransactionManager' });

export interface TransactionOptions {
  atomic: boolean;
  dryRun: boolean;
}

export interface TransactionResult {
  success: boolean;
  transactionId: string;
  filesModified: number;
  totalChanges: number;
  changes: Array<{
    uri: string;
    edits: number;
    preview?: string;
  }>;
  errors?: Array<{
    uri: string;
    error: string;
  }>;
}

export interface FileBackup {
  uri: string;
  originalContent: string;
  originalExists: boolean;
  tempPath?: string;
}

export interface TransactionBackup {
  id: string;
  timestamp: Date;
  files: Map<string, FileBackup>;
}

export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly transactionId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

export class EditTransactionManager {
  private activeTransactions = new Map<string, TransactionBackup>();
  private logger = logger;
  private workspaceRoot = process.cwd();

  async executeTransaction(
    edits: WorkspaceEdit[],
    options: TransactionOptions
  ): Promise<TransactionResult> {
    const transactionId = randomUUID();
    const startTime = Date.now();

    this.logger.info({ transactionId, editsCount: edits.length }, 'Starting transaction');

    if (options.dryRun) {
      return this.simulateTransaction(edits, transactionId);
    }

    const backup = await this.createBackup(edits, transactionId);
    this.activeTransactions.set(transactionId, backup);

    try {
      await this.validateEdits(edits);

      const results = await this.applyEdits(edits, options);

      this.verifyEdits(results);

      const successResult = this.createSuccessResult(results, transactionId);

      this.logger.info(
        {
          transactionId,
          duration: Date.now() - startTime,
          filesModified: successResult.filesModified,
        },
        'Transaction completed successfully'
      );

      return successResult;
    } catch (error) {
      this.logger.error({ error, transactionId }, 'Transaction failed, rolling back');

      if (options.atomic) {
        await this.rollback(backup);
      }

      throw new TransactionError(
        error instanceof Error ? error.message : 'Transaction failed',
        transactionId,
        error
      );
    } finally {
      this.cleanupBackup(backup);
      this.activeTransactions.delete(transactionId);
    }
  }

  private async createBackup(
    edits: WorkspaceEdit[],
    transactionId: string
  ): Promise<TransactionBackup> {
    const backup: TransactionBackup = {
      id: transactionId,
      timestamp: new Date(),
      files: new Map(),
    };

    const affectedUris = this.getAffectedUris(edits);

    for (const uri of affectedUris) {
      try {
        const filePath = fileURLToPath(uri);
        
        // Validate path is within workspace
        validateFilePath(filePath, this.workspaceRoot);

        const exists = await this.fileExists(filePath);
        if (exists) {
          const content = await readFile(filePath, 'utf-8');
          backup.files.set(uri, {
            uri,
            originalContent: content,
            originalExists: true,
          });
        } else {
          backup.files.set(uri, {
            uri,
            originalContent: '',
            originalExists: false,
          });
        }
      } catch (error) {
        this.logger.error({ error, uri }, 'Failed to backup file');
        throw new Error(`Failed to backup file ${uri}: ${String(error)}`);
      }
    }

    this.logger.info({ transactionId, filesBackedUp: backup.files.size }, 'Backup created');

    return backup;
  }

  private async rollback(backup: TransactionBackup): Promise<void> {
    this.logger.info({ transactionId: backup.id }, 'Starting rollback');

    const errors: string[] = [];

    for (const [uri, fileBackup] of backup.files) {
      try {
        const filePath = fileURLToPath(uri);

        if (fileBackup.originalExists) {
          await this.ensureDirectory(dirname(filePath));
          await writeFile(filePath, fileBackup.originalContent, 'utf-8');
        } else {
          try {
            await unlink(filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to rollback ${uri}: ${String(error)}`;
        this.logger.error({ error, uri }, errorMsg);
        errors.push(errorMsg);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Rollback partially failed:\n${errors.join('\n')}`);
    }

    this.logger.info({ transactionId: backup.id }, 'Rollback completed');
  }

  private cleanupBackup(backup: TransactionBackup): void {
    // In a production implementation, you might want to keep backups
    // for a certain period or move them to a backup directory
    this.logger.debug({ transactionId: backup.id }, 'Cleaning up backup');
  }

  private async validateEdits(edits: WorkspaceEdit[]): Promise<void> {
    for (const edit of edits) {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('kind' in change) {
            if (change.kind === 'create') {
              const createOp = change;
              const filePath = fileURLToPath(createOp.uri);
              const dir = dirname(filePath);

              if (!(await this.fileExists(dir))) {
                throw new Error(`Parent directory does not exist: ${dir}`);
              }
            }
          }
        }
      }
    }
  }

  private async applyEdits(
    edits: WorkspaceEdit[],
    options: TransactionOptions
  ): Promise<ApplyWorkspaceEditResult[]> {
    const results: ApplyWorkspaceEditResult[] = [];

    for (const edit of edits) {
      try {
        const result = await this.applySingleEdit(edit);
        results.push(result);

        if (!result.applied && options.atomic) {
          throw new Error(`Edit failed: ${result.failureReason || 'Unknown reason'}`);
        }
      } catch (error) {
        if (options.atomic) {
          throw error;
        }

        results.push({
          applied: false,
          failureReason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private async applySingleEdit(edit: WorkspaceEdit): Promise<ApplyWorkspaceEditResult> {
    try {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            const textEdit = change;
            await this.applyTextDocumentEdit(textEdit);
          } else if ('kind' in change) {
            await this.applyResourceOperation(change);
          }
        }
      } else if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          await this.applyTextEdits(uri, textEdits);
        }
      }

      return { applied: true };
    } catch (error) {
      return {
        applied: false,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async applyTextDocumentEdit(edit: TextDocumentEdit): Promise<void> {
    const filePath = fileURLToPath(edit.textDocument.uri);
    const content = await readFile(filePath, 'utf-8');

    let newContent = content;
    const sortedEdits = [...edit.edits].sort((a, b) => {
      const lineDiff = b.range.start.line - a.range.start.line;
      return lineDiff !== 0 ? lineDiff : b.range.start.character - a.range.start.character;
    });

    for (const textEdit of sortedEdits) {
      newContent = this.applyTextEdit(newContent, textEdit);
    }

    await this.ensureDirectory(dirname(filePath));
    await writeFile(filePath, newContent, 'utf-8');
  }

  private applyTextEdit(content: string, edit: TextEdit): string {
    const lines = content.split('\n');
    const { start, end } = edit.range;

    const startLine = lines[start.line] || '';
    const endLine = lines[end.line] || '';

    const before = startLine.substring(0, start.character);
    const after = endLine.substring(end.character);

    const newLines = [before + edit.newText + after];

    lines.splice(start.line, end.line - start.line + 1, ...newLines);

    return lines.join('\n');
  }

  private async applyTextEdits(uri: string, edits: TextEdit[]): Promise<void> {
    const filePath = fileURLToPath(uri);
    const content = await readFile(filePath, 'utf-8');

    let newContent = content;
    const sortedEdits = [...edits].sort((a, b) => {
      const lineDiff = b.range.start.line - a.range.start.line;
      return lineDiff !== 0 ? lineDiff : b.range.start.character - a.range.start.character;
    });

    for (const edit of sortedEdits) {
      newContent = this.applyTextEdit(newContent, edit);
    }

    await this.ensureDirectory(dirname(filePath));
    await writeFile(filePath, newContent, 'utf-8');
  }

  private async applyResourceOperation(
    operation: CreateFile | RenameFile | DeleteFile
  ): Promise<void> {
    if (operation.kind === 'create') {
      const createOp = operation;
      const filePath = fileURLToPath(createOp.uri);
      await this.ensureDirectory(dirname(filePath));
      await writeFile(filePath, '', 'utf-8');
    } else if (operation.kind === 'rename') {
      const renameOp = operation;
      const oldPath = fileURLToPath(renameOp.oldUri);
      const newPath = fileURLToPath(renameOp.newUri);
      await this.ensureDirectory(dirname(newPath));
      await rename(oldPath, newPath);
    } else if (operation.kind === 'delete') {
      const deleteOp = operation;
      const filePath = fileURLToPath(deleteOp.uri);
      await unlink(filePath);
    }
  }

  private verifyEdits(results: ApplyWorkspaceEditResult[]): void {
    const failed = results.filter((r) => !r.applied);
    if (failed.length > 0) {
      const reasons = failed
        .map((r) => r.failureReason)
        .filter(Boolean)
        .join(', ');
      throw new Error(`${failed.length} edits failed: ${reasons}`);
    }
  }

  private createSuccessResult(
    results: ApplyWorkspaceEditResult[],
    transactionId: string
  ): TransactionResult {
    // Calculate the actual number of edits from the results
    // Each result may contain multiple edits (editCount property)
    const totalChanges = results.reduce((sum, result) => {
      // If editCount is available, use it; otherwise count as 1 edit
      return sum + ((result as any).editCount || 1);
    }, 0);

    return {
      success: true,
      transactionId,
      filesModified: results.filter((r) => r.applied).length,
      totalChanges,
      changes: [],
    };
  }

  private simulateTransaction(edits: WorkspaceEdit[], transactionId: string): TransactionResult {
    const changes: TransactionResult['changes'] = [];
    let totalChanges = 0;
    const filesModified = new Set<string>();

    for (const edit of edits) {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            const textEdit = change;
            filesModified.add(textEdit.textDocument.uri);
            totalChanges += textEdit.edits.length;
            changes.push({
              uri: textEdit.textDocument.uri,
              edits: textEdit.edits.length,
            });
          }
        }
      } else if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          filesModified.add(uri);
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
      transactionId,
      filesModified: filesModified.size,
      totalChanges,
      changes,
    };
  }

  private getAffectedUris(edits: WorkspaceEdit[]): Set<string> {
    const uris = new Set<string>();

    for (const edit of edits) {
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            uris.add(change.textDocument.uri);
          } else if ('uri' in change) {
            const resourceOp = change;
            uris.add(resourceOp.uri);
          } else if ('oldUri' in change) {
            const renameOp = change;
            uris.add(renameOp.oldUri);
            uris.add(renameOp.newUri);
          }
        }
      } else if (edit.changes) {
        for (const uri of Object.keys(edit.changes)) {
          uris.add(uri);
        }
      }
    }

    return uris;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDirectory(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
