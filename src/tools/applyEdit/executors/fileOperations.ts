import {
  WorkspaceEdit,
  CreateFile,
  DeleteFile,
  RenameFile,
  TextDocumentEdit,
} from 'vscode-languageserver-protocol';
import type { ApplyEditParams } from '../schemas.js';
import { fileURLToPath } from 'url';
import { sanitizeFileURI, validateFilePath } from '../../../utils/path-security.js';

export function executeFileOperations(params: ApplyEditParams): WorkspaceEdit[] {
  if (!params.fileOperation) {
    throw new Error('No file operation parameters specified');
  }

  const { operations } = params.fileOperation;
  const documentChanges: Array<CreateFile | DeleteFile | RenameFile | TextDocumentEdit> = [];
  const workspaceRoot = process.cwd();

  for (const operation of operations) {
    switch (operation.type) {
      case 'create': {
        // Validate and sanitize URI
        const sanitizedUri = sanitizeFileURI(operation.uri);
        validateFilePath(fileURLToPath(sanitizedUri), workspaceRoot);
        
        const createOp: CreateFile = {
          kind: 'create',
          uri: sanitizedUri,
          options: {
            overwrite: operation.overwrite,
            ignoreIfExists: !operation.overwrite,
          },
        };
        documentChanges.push(createOp);

        // If content is provided, add a text edit to write it
        if (operation.content) {
          const textEdit: TextDocumentEdit = {
            textDocument: { uri: sanitizedUri, version: null },
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: operation.content,
              },
            ],
          };
          documentChanges.push(textEdit);
        }
        break;
      }

      case 'delete': {
        // Validate and sanitize URI
        const sanitizedUri = sanitizeFileURI(operation.uri);
        validateFilePath(fileURLToPath(sanitizedUri), workspaceRoot);
        
        const deleteOp: DeleteFile = {
          kind: 'delete',
          uri: sanitizedUri,
          options: {
            recursive: operation.recursive,
            ignoreIfNotExists: operation.ignoreIfNotExists,
          },
        };
        documentChanges.push(deleteOp);
        break;
      }

      case 'rename': {
        // Validate and sanitize both URIs
        const sanitizedOldUri = sanitizeFileURI(operation.oldUri);
        const sanitizedNewUri = sanitizeFileURI(operation.newUri);
        validateFilePath(fileURLToPath(sanitizedOldUri), workspaceRoot);
        validateFilePath(fileURLToPath(sanitizedNewUri), workspaceRoot);
        
        const renameOp: RenameFile = {
          kind: 'rename',
          oldUri: sanitizedOldUri,
          newUri: sanitizedNewUri,
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

  const workspaceEdit: WorkspaceEdit = {
    documentChanges,
  };

  return [workspaceEdit];
}