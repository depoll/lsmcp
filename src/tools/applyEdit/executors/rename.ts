import { WorkspaceEdit, RenameParams } from 'vscode-languageserver-protocol';
import type { LSPClient } from '../../../lsp/client-v2.js';
import type { ApplyEditParams } from '../schemas.js';
import { logger as baseLogger } from '../../../utils/logger.js';

const logger = baseLogger.child({ component: 'ApplyEditTool.rename' });

export async function executeRename(
  params: ApplyEditParams,
  getClient: (uri: string) => Promise<LSPClient>
): Promise<WorkspaceEdit[]> {
  if (!params.rename) {
    throw new Error('No rename parameters specified');
  }

  const { uri, position, newName } = params.rename;

  // Log the exact parameters received
  logger.info(
    {
      uri,
      position,
      newName,
      paramsRaw: JSON.stringify(params.rename),
    },
    'executeRename called with parameters'
  );

  const client = await getClient(uri);

  // Ensure the file is opened in the language server
  await client.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: getLanguageId(uri),
      version: 1,
      text: await getFileContent(uri),
    },
  });

  const renameParams: RenameParams = {
    textDocument: { uri },
    position,
    newName,
  };

  // First, check if rename is available at the position using prepareRename
  try {
    const prepareResult = await client.sendRequest('textDocument/prepareRename', {
      textDocument: { uri },
      position,
    });

    logger.info({ prepareResult }, 'prepareRename result');

    if (!prepareResult) {
      throw new Error('Rename not available at the specified position');
    }
  } catch (error) {
    logger.warn({ error }, 'prepareRename failed, continuing with rename anyway');
  }

  // Execute the rename
  const workspaceEdit = await client.sendRequest('textDocument/rename', renameParams);

  if (!workspaceEdit) {
    throw new Error('No rename edits returned from language server');
  }

  // Apply file limits if specified
  if (params.rename.maxFiles) {
    const fileCount = countAffectedFiles(workspaceEdit);
    if (fileCount > params.rename.maxFiles) {
      throw new Error(
        `Rename would affect ${fileCount} files, exceeding limit of ${params.rename.maxFiles}`
      );
    }
  }

  // Filter out excluded patterns if specified
  if (params.rename.excludePatterns && params.rename.excludePatterns.length > 0) {
    filterWorkspaceEdit(workspaceEdit, params.rename.excludePatterns);
  }

  return [workspaceEdit];
}

function getLanguageId(uri: string): string {
  const ext = uri.substring(uri.lastIndexOf('.') + 1);
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    elm: 'elm',
    clj: 'clojure',
    hs: 'haskell',
  };
  return languageMap[ext] || 'plaintext';
}

async function getFileContent(uri: string): Promise<string> {
  // This should be injected as a dependency
  const { readFile } = await import('fs/promises');
  const filePath = new URL(uri).pathname;
  return readFile(filePath, 'utf-8');
}

function countAffectedFiles(edit: WorkspaceEdit): number {
  const files = new Set<string>();

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('textDocument' in change) {
        files.add(change.textDocument.uri);
      } else if ('uri' in change) {
        files.add(change.uri);
      } else if ('oldUri' in change) {
        files.add(change.oldUri);
        files.add(change.newUri);
      }
    }
  } else if (edit.changes) {
    for (const uri of Object.keys(edit.changes)) {
      files.add(uri);
    }
  }

  return files.size;
}

function filterWorkspaceEdit(edit: WorkspaceEdit, excludePatterns: string[]): void {
  // Implementation would use minimatch or similar to filter out excluded files
  // For now, this is a placeholder
  logger.warn({ excludePatterns }, 'Exclude patterns not yet implemented');
}