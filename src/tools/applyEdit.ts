import { WorkspaceEdit } from 'vscode-languageserver-protocol';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { getLanguageFromUri } from '../utils/languages.js';
import { MCPError, MCPErrorCode } from './common-types.js';
import { z } from 'zod';

// Simple schema for workspace edits
const ApplyEditParamsSchema = z.object({
  edit: z.custom<WorkspaceEdit>(),
  label: z.string().optional(),
});

export type ApplyEditParams = z.infer<typeof ApplyEditParamsSchema>;

export interface ApplyEditResult {
  applied: boolean;
  failureReason?: string;
  failedChange?: string;
}

export class ApplyEditTool extends BatchableTool<ApplyEditParams, ApplyEditResult> {
  readonly name = 'applyEdit';
  readonly description = 'Apply a WorkspaceEdit via LSP workspace/applyEdit method';
  readonly inputSchema = ApplyEditParamsSchema;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: ApplyEditParams): Promise<ApplyEditResult> {
    const validatedParams = this.validateParams(params);

    // Get the first URI from the edit to determine which LSP client to use
    const uri = this.getFirstUri(validatedParams.edit);
    if (!uri) {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, 'No URIs found in workspace edit');
    }

    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, uri);

    if (!client) {
      throw new MCPError(
        MCPErrorCode.InternalError,
        `No language server available for ${language}`
      );
    }

    if (!client.isConnected()) {
      throw new MCPError(
        MCPErrorCode.InternalError,
        `Language server not connected for ${language}`
      );
    }

    // Apply the edit using LSP workspace/applyEdit
    const result = await client.sendRequest<{
      applied: boolean;
      failureReason?: string;
      failedChange?: string;
    }>('workspace/applyEdit', {
      label: validatedParams.label,
      edit: validatedParams.edit,
    });

    return {
      applied: result.applied,
      failureReason: result.failureReason,
      failedChange: result.failedChange,
    };
  }

  protected validateParams(params: ApplyEditParams): ApplyEditParams {
    const result = this.inputSchema.safeParse(params);
    if (!result.success) {
      throw new MCPError(MCPErrorCode.INVALID_PARAMS, result.error.message);
    }
    return result.data;
  }

  private getFirstUri(edit: WorkspaceEdit): string | undefined {
    // Check documentChanges first
    if (edit.documentChanges && edit.documentChanges.length > 0) {
      const firstChange = edit.documentChanges[0];
      if (firstChange && 'textDocument' in firstChange) {
        return firstChange.textDocument.uri;
      } else if (firstChange && 'uri' in firstChange) {
        return firstChange.uri;
      } else if (firstChange && 'oldUri' in firstChange) {
        return firstChange.oldUri;
      }
    }

    // Check changes map
    if (edit.changes) {
      const uris = Object.keys(edit.changes);
      if (uris.length > 0) {
        return uris[0];
      }
    }

    return undefined;
  }

  async executeBatch(operations: ApplyEditParams[]): Promise<ApplyEditResult[]> {
    return Promise.all(operations.map((op) => this.execute(op)));
  }
}
