import {
  WorkspaceEdit,
  CodeAction,
  CodeActionParams,
  Diagnostic,
  CodeActionKind,
  Command,
} from 'vscode-languageserver-protocol';
import type { LSPClient } from '../../../lsp/client-v2.js';
import type { ApplyEditParams } from '../schemas.js';
import { logger as baseLogger } from '../../../utils/logger.js';

const logger = baseLogger.child({ component: 'ApplyEditTool.codeActions' });

export async function executeCodeActions(
  params: ApplyEditParams,
  getClient: (uri: string) => Promise<LSPClient>
): Promise<WorkspaceEdit[]> {
  if (!params.actions || params.actions.length === 0) {
    throw new Error('No code actions specified');
  }

  const edits: WorkspaceEdit[] = [];

  for (const action of params.actions) {
    const client = await getClient(action.uri);

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

    try {
      const codeActions = await client.sendRequest<Array<CodeAction | Command> | null>(
        'textDocument/codeAction',
        codeActionParams
      );

      if (!codeActions || codeActions.length === 0) {
        logger.warn({ uri: action.uri }, 'No code actions available');
        continue;
      }

      const actionsToApply = selectCodeActions(codeActions, action);

      for (const codeAction of actionsToApply) {
        const edit = await applyCodeAction(codeAction, client);
        if (edit) {
          edits.push(edit);
        }
      }
    } catch (error) {
      logger.error({ error, uri: action.uri }, 'Failed to get code actions');
      throw error;
    }
  }

  return edits;
}

function selectCodeActions(
  codeActions: Array<CodeAction | Command>,
  params: NonNullable<ApplyEditParams['actions']>[0]
): Array<CodeAction | Command> {
  // Filter out commands that aren't code actions
  const validActions = codeActions.filter(
    (action): action is CodeAction => 'edit' in action || 'command' in action
  );

  if (validActions.length === 0) {
    return [];
  }

  switch (params.selectionStrategy) {
    case 'all':
      return validActions.slice(0, params.maxActions || 5);

    case 'preferred':
      if (params.preferredKinds && params.preferredKinds.length > 0) {
        for (const kind of params.preferredKinds) {
          const matching = validActions.find((a) => 'kind' in a && a.kind === kind);
          if (matching) return [matching];
        }
      }
      return validActions[0] ? [validActions[0]] : [];

    case 'best-match':
      if (params.diagnostic) {
        const diagnosticMatching = validActions.find((action) => {
          if (!('diagnostics' in action) || !action.diagnostics || action.diagnostics.length === 0)
            return false;
          return action.diagnostics.some(
            (d) => d.message === params.diagnostic!.message && d.code === params.diagnostic!.code
          );
        });
        if (diagnosticMatching) return [diagnosticMatching];
      }
      return validActions[0] ? [validActions[0]] : [];

    case 'first':
    default:
      return validActions[0] ? [validActions[0]] : [];
  }
}

async function applyCodeAction(
  codeAction: CodeAction | Command,
  client: LSPClient
): Promise<WorkspaceEdit | null> {
  if ('edit' in codeAction && codeAction.edit) {
    return codeAction.edit;
  }

  if ('command' in codeAction && codeAction.command) {
    const command =
      typeof codeAction.command === 'string' ? { command: codeAction.command } : codeAction.command;
    try {
      const result = await client.sendRequest('workspace/executeCommand', command);
      if (result && typeof result === 'object' && 'documentChanges' in result) {
        return result as WorkspaceEdit;
      }
    } catch (error) {
      logger.error({ error, command: command.command }, 'Failed to execute command');
      throw error;
    }
  }

  return null;
}
