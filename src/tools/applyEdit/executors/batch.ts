import { WorkspaceEdit } from 'vscode-languageserver-protocol';
import type { ApplyEditParams } from '../schemas.js';
import type { LSPClient } from '../../../lsp/client-v2.js';
import { executeCodeActions } from './codeActions.js';
import { executeRename } from './rename.js';
import { executeFormat, executeOrganizeImports } from './format.js';
import { executeTextEdit, executeMultiFileEdit } from './textEdit.js';
import { executeSearchReplace } from './searchReplace.js';
import { executeFileOperations } from './fileOperations.js';
import { executeSmartInsert } from './smartInsert.js';

export async function executeBatchOperations(
  params: ApplyEditParams,
  getClient: (uri: string) => Promise<LSPClient>,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<WorkspaceEdit[]> {
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
          edits = await executeCodeActions(
            {
              type: 'codeAction',
              actions: operation.actions,
              dryRun: false,
              atomic: false,
            },
            getClient
          );
          break;

        case 'rename':
          edits = await executeRename(
            {
              type: 'rename',
              rename: operation.rename,
              dryRun: false,
              atomic: false,
            },
            getClient
          );
          break;

        case 'format':
          edits = await executeFormat(
            {
              type: 'format',
              format: operation.format,
              dryRun: false,
              atomic: false,
            },
            getClient
          );
          break;

        case 'organizeImports':
          edits = await executeOrganizeImports(
            {
              type: 'organizeImports',
              format: operation.format,
              dryRun: false,
              atomic: false,
            },
            (params) => executeCodeActions(params, getClient)
          );
          break;

        case 'textEdit':
          edits = executeTextEdit({
            type: 'textEdit',
            textEdit: operation.textEdit,
            dryRun: false,
            atomic: false,
          });
          break;

        case 'multiFileEdit':
          edits = executeMultiFileEdit({
            type: 'multiFileEdit',
            multiFileEdit: operation.multiFileEdit,
            dryRun: false,
            atomic: false,
          });
          break;

        case 'searchReplace':
          edits = await executeSearchReplace({
            type: 'searchReplace',
            searchReplace: operation.searchReplace,
            dryRun: false,
            atomic: false,
          });
          break;

        case 'fileOperation':
          edits = executeFileOperations({
            type: 'fileOperation',
            fileOperation: operation.fileOperation,
            dryRun: false,
            atomic: false,
          });
          break;

        case 'smartInsert':
          edits = await executeSmartInsert(
            {
              type: 'smartInsert',
              smartInsert: operation.smartInsert,
              dryRun: false,
              atomic: false,
            },
            readFileFn
          );
          break;
      }

      allEdits.push(...edits);
    } catch (error) {
      // In batch mode, we might want to continue or stop on error
      // For now, we'll throw and let the transaction manager handle it
      throw error;
    }
  }

  return allEdits;
}