/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked functions are properly bound */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import { MCPError, MCPErrorCode } from '../../../src/tools/common-types.js';
import type { LSPClient } from '../../../src/lsp/client-v2.js';

jest.mock('../../../src/lsp/index.js');

describe('ApplyEditTool', () => {
  let tool: ApplyEditTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;

  beforeEach(() => {
    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClient>;

    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new ApplyEditTool(mockClientManager);
  });

  describe('execute', () => {
    it('should apply workspace edit successfully', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [
            TextEdit.replace(
              { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              'hello'
            ),
          ],
        },
      };

      mockClient.sendRequest.mockResolvedValue({
        applied: true,
      });

      const result = await tool.execute({ edit });

      expect(result).toMatchObject({
        applied: true,
        failureReason: undefined,
        failedChange: undefined,
      });
      expect(result.summary).toBe('1 edit in 1 file');
      expect(result.diff).toContain('File: ');
      expect(result.diff).toContain('@ Line 1');

      expect(jest.mocked(mockClient.sendRequest)).toHaveBeenCalledWith('workspace/applyEdit', {
        label: undefined,
        edit,
      });
    });

    it('should handle workspace edit with label', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [
            TextEdit.replace(
              { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              'hello'
            ),
          ],
        },
      };

      mockClient.sendRequest.mockResolvedValue({
        applied: true,
      });

      const result = await tool.execute({ edit, label: 'Test Edit' });

      expect(result.applied).toBe(true);
      expect(result.summary).toBe('1 edit in 1 file');
      expect(result.diff).toBeDefined();
      expect(jest.mocked(mockClient.sendRequest)).toHaveBeenCalledWith('workspace/applyEdit', {
        label: 'Test Edit',
        edit,
      });
    });

    it('should handle failed workspace edit', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [
            TextEdit.replace(
              { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              'hello'
            ),
          ],
        },
      };

      mockClient.sendRequest.mockResolvedValue({
        applied: false,
        failureReason: 'File not found',
      });

      const result = await tool.execute({ edit });

      expect(result).toMatchObject({
        applied: false,
        failureReason: 'File not found',
        failedChange: undefined,
      });
      expect(result.summary).toBe('1 edit in 1 file');
      expect(result.diff).toContain('File: ');
      expect(result.diff).toContain('@ Line 1');
    });

    it('should throw error when no URI found in edit', async () => {
      const edit: WorkspaceEdit = {};

      await expect(tool.execute({ edit })).rejects.toThrow(
        new MCPError(MCPErrorCode.INVALID_PARAMS, 'No URIs found in workspace edit')
      );
    });

    it('should throw error when no client available', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [],
        },
      };

      mockClientManager.get = jest.fn(() =>
        Promise.resolve(null)
      ) as unknown as typeof mockClientManager.get;

      await expect(tool.execute({ edit })).rejects.toThrow(
        new MCPError(MCPErrorCode.InternalError, 'No language server available for typescript')
      );
    });

    it('should throw error when client not connected', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [],
        },
      };

      mockClient.isConnected.mockReturnValue(false);

      await expect(tool.execute({ edit })).rejects.toThrow(
        new MCPError(MCPErrorCode.InternalError, 'Language server not connected for typescript')
      );
    });

    it('should extract URI from documentChanges', async () => {
      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test.ts', version: 1 },
            edits: [],
          },
        ],
      };

      mockClient.sendRequest.mockResolvedValue({ applied: true });

      const result = await tool.execute({ edit });

      expect(result.applied).toBe(true);
      expect(jest.mocked(mockClientManager.get)).toHaveBeenCalledWith(
        'typescript',
        'file:///test.ts'
      );
    });

    it('should extract URI from create file operation', async () => {
      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'create',
            uri: 'file:///new.ts',
          },
        ],
      };

      mockClient.sendRequest.mockResolvedValue({ applied: true });

      const result = await tool.execute({ edit });

      expect(result.applied).toBe(true);
      expect(jest.mocked(mockClientManager.get)).toHaveBeenCalledWith(
        'typescript',
        'file:///new.ts'
      );
    });

    it('should extract URI from rename file operation', async () => {
      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'rename',
            oldUri: 'file:///old.ts',
            newUri: 'file:///new.ts',
          },
        ],
      };

      mockClient.sendRequest.mockResolvedValue({ applied: true });

      const result = await tool.execute({ edit });

      expect(result.applied).toBe(true);
      expect(jest.mocked(mockClientManager.get)).toHaveBeenCalledWith(
        'typescript',
        'file:///old.ts'
      );
    });
  });

  describe('executeBatch', () => {
    it('should execute multiple operations in parallel', async () => {
      const edits = [
        {
          edit: {
            changes: {
              'file:///test1.ts': [],
            },
          } as WorkspaceEdit,
        },
        {
          edit: {
            changes: {
              'file:///test2.ts': [],
            },
          } as WorkspaceEdit,
        },
      ];

      mockClient.sendRequest.mockResolvedValue({ applied: true });

      const results = await tool.executeBatch(edits);

      expect(results).toHaveLength(2);
      expect(results[0]?.applied).toBe(true);
      expect(results[1]?.applied).toBe(true);
      expect(jest.mocked(mockClient.sendRequest)).toHaveBeenCalledTimes(2);
    });
  });
});
