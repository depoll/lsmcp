import { WorkspaceEdit, TextEdit, Range } from 'vscode-languageserver-protocol';
import type { ApplyEditParams } from '../schemas.js';

export function executeTextEdit(params: ApplyEditParams): WorkspaceEdit[] {
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

export function executeMultiFileEdit(params: ApplyEditParams): WorkspaceEdit[] {
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
