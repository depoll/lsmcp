/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked functions are properly bound */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
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

      expect(result.data).toMatchObject({
        applied: true,
        failureReason: undefined,
        failedChange: undefined,
      });
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toContain('File: ');
      expect(result.data.diff).toContain('@ Line 1');

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

      expect(result.data.applied).toBe(true);
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toBeDefined();
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

      expect(result.data).toMatchObject({
        applied: false,
        failureReason: 'File not found',
        failedChange: undefined,
      });
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toContain('File: ');
      expect(result.data.diff).toContain('@ Line 1');
    });

    it('should handle error when no URI found in edit', async () => {
      const edit: WorkspaceEdit = {};

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('No URIs found in workspace edit');
      expect(result.error).toContain('No URIs found in workspace edit');
      expect(result.fallback).toBeDefined();
    });

    it('should handle error when no client available', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [],
        },
      };

      mockClientManager.get = jest.fn(() =>
        Promise.resolve(null)
      ) as unknown as typeof mockClientManager.get;

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('No language server available');
      expect(result.error).toContain('No language server available');
      expect(result.fallback).toBeDefined();
    });

    it('should handle error when client not connected', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test.ts': [],
        },
      };

      mockClient.isConnected.mockReturnValue(false);

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('Language server not connected');
      expect(result.error).toContain('Language server not connected');
      expect(result.fallback).toBeDefined();
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

      expect(result.data.applied).toBe(true);
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

      expect(result.data.applied).toBe(true);
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

      expect(result.data.applied).toBe(true);
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
      expect(results[0]?.data.applied).toBe(true);
      expect(results[1]?.data.applied).toBe(true);
      expect(jest.mocked(mockClient.sendRequest)).toHaveBeenCalledTimes(2);
    });
  });
});
