import {
  WorkspaceEdit,
  DocumentFormattingParams,
  FormattingOptions,
  TextEdit,
  DocumentRangeFormattingParams,
} from 'vscode-languageserver-protocol';
import type { LSPClient } from '../../../lsp/client-v2.js';
import type { ApplyEditParams } from '../schemas.js';

export async function executeFormat(
  params: ApplyEditParams,
  getClient: (uri: string) => Promise<LSPClient>
): Promise<WorkspaceEdit[]> {
  if (!params.format) {
    throw new Error('No format parameters specified');
  }

  const uris = Array.isArray(params.format.uris) ? params.format.uris : [params.format.uris];
  const edits: WorkspaceEdit[] = [];

  for (const uri of uris) {
    const client = await getClient(uri);

    let textEdits: TextEdit[] | null;

    if (params.format.range) {
      // Range formatting
      const rangeFormattingParams: DocumentRangeFormattingParams = {
        textDocument: { uri },
        range: params.format.range,
        options: (params.format.options as FormattingOptions) || {
          tabSize: 2,
          insertSpaces: true,
        },
      };
      textEdits = await client.sendRequest('textDocument/rangeFormatting', rangeFormattingParams);
    } else {
      // Full document formatting
      const formattingParams: DocumentFormattingParams = {
        textDocument: { uri },
        options: (params.format.options as FormattingOptions) || {
          tabSize: 2,
          insertSpaces: true,
        },
      };
      textEdits = await client.sendRequest('textDocument/formatting', formattingParams);
    }

    if (textEdits && textEdits.length > 0) {
      const workspaceEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri, version: null },
            edits: textEdits,
          },
        ],
      };
      edits.push(workspaceEdit);
    }
  }

  return edits;
}

export async function executeOrganizeImports(
  params: ApplyEditParams,
  executeCodeActions: (params: ApplyEditParams) => Promise<WorkspaceEdit[]>
): Promise<WorkspaceEdit[]> {
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
          selectionStrategy: 'preferred',
          preferredKinds: ['source.organizeImports', 'source.sortImports', 'source.fixAll'],
        },
      ],
      dryRun: false,
      atomic: false,
    };

    const actionEdits = await executeCodeActions(organizeAction);
    edits.push(...actionEdits);
  }

  return edits;
}
