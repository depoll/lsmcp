import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { RenameSymbolTool } from '../../../src/tools/renameSymbol.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import { MCPError, MCPErrorCode } from '../../../src/tools/common-types.js';
import type { MessageConnection } from 'vscode-languageserver-protocol';
import type { Location, WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';

// Mock dependencies
jest.mock('../../../src/lsp/manager.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('RenameSymbolTool', () => {
  let tool: RenameSymbolTool;
  let mockPool: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;
  let mockConnection: jest.Mocked<MessageConnection>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock connection
    mockConnection = {
      sendRequest: jest.fn(),
    } as any;

    // Setup mock client
    mockClient = {
      connection: mockConnection,
      capabilities: {
        renameProvider: true,
      },
      rootUri: 'file:///workspace',
    } as any;

    // Setup mock pool - get should return the client
    mockPool = {
      get: jest.fn().mockResolvedValue(mockClient),
      getForFile: jest.fn().mockResolvedValue(mockClient),
      getAllActive: jest.fn().mockReturnValue([]),
    } as any;

    tool = new RenameSymbolTool(mockPool);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Parameter validation', () => {
    it('should accept location object with newName', async () => {
      const location: Location = {
        uri: 'file:///workspace/file.ts',
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      const workspaceEdit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file.ts': [
            {
              range: location.range,
              newText: 'newVariable',
            },
          ],
        },
      };

      mockConnection.sendRequest.mockResolvedValue(workspaceEdit);

      const result = await tool.execute({
        location,
        newName: 'newVariable',
      });

      expect(result.summary.filesChanged).toBe(1);
      expect(result.summary.editsApplied).toBe(1);
    });

    it('should accept explicit uri and position with newName', async () => {
      const workspaceEdit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file.ts': [
            {
              range: {
                start: { line: 10, character: 5 },
                end: { line: 10, character: 15 },
              },
              newText: 'newFunction',
            },
          ],
        },
      };

      mockConnection.sendRequest.mockResolvedValue(workspaceEdit);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        position: { line: 10, character: 8 },
        newName: 'newFunction',
      });

      expect(result.summary.filesChanged).toBe(1);
      expect(mockConnection.sendRequest).toHaveBeenCalledWith(
        'textDocument/rename',
        expect.objectContaining({
          textDocument: { uri: 'file:///workspace/file.ts' },
          position: { line: 10, character: 8 },
          newName: 'newFunction',
        })
      );
    });

    it('should reject when both location and uri are provided', async () => {
      await expect(
        tool.execute({
          location: {
            uri: 'file:///workspace/file.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
          uri: 'file:///workspace/file.ts',
          position: { line: 0, character: 0 },
          newName: 'test',
        } as any)
      ).rejects.toThrow(MCPError);
    });

    it('should reject when newName is missing', async () => {
      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          position: { line: 0, character: 0 },
        } as any)
      ).rejects.toThrow();
    });
  });

  describe('Rename operation', () => {
    it('should handle successful rename across multiple files', async () => {
      const workspaceEdit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file1.ts': [
            {
              range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
              newText: 'renamedSymbol',
            },
            {
              range: { start: { line: 20, character: 10 }, end: { line: 20, character: 20 } },
              newText: 'renamedSymbol',
            },
          ],
          'file:///workspace/file2.ts': [
            {
              range: { start: { line: 5, character: 15 }, end: { line: 5, character: 25 } },
              newText: 'renamedSymbol',
            },
          ],
        },
      };

      mockConnection.sendRequest.mockResolvedValue(workspaceEdit);

      const result = await tool.execute({
        uri: 'file:///workspace/file1.ts',
        position: { line: 10, character: 8 },
        newName: 'renamedSymbol',
      });

      expect(result.summary.filesChanged).toBe(2);
      expect(result.summary.editsApplied).toBe(3);
      expect(result.summary.success).toBe(true);
      expect(result.changedFiles).toHaveLength(2);
    });

    it('should handle empty workspace edit (no rename possible)', async () => {
      mockConnection.sendRequest.mockResolvedValue({ changes: {} });

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        position: { line: 10, character: 8 },
        newName: 'newName',
      });

      expect(result.summary.filesChanged).toBe(0);
      expect(result.summary.editsApplied).toBe(0);
      expect(result.summary.success).toBe(true);
      expect(result.summary.message).toContain('No changes');
    });

    it('should handle null response (rename not supported at position)', async () => {
      mockConnection.sendRequest.mockResolvedValue(null);

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          position: { line: 10, character: 8 },
          newName: 'newName',
        })
      ).rejects.toThrow(MCPError);
    });

    it('should handle language server without rename support', async () => {
      mockClient.capabilities = {};

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          position: { line: 10, character: 8 },
          newName: 'newName',
        })
      ).rejects.toThrow('does not support rename operations');
    });
  });

  describe('Error handling', () => {
    it('should handle language server errors gracefully', async () => {
      mockConnection.sendRequest.mockRejectedValue(new Error('Language server crashed'));

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          position: { line: 10, character: 8 },
          newName: 'newName',
        })
      ).rejects.toThrow('Failed to rename symbol');
    });

    it('should handle invalid URI format', async () => {
      await expect(
        tool.execute({
          uri: 'not-a-valid-uri',
          position: { line: 10, character: 8 },
          newName: 'newName',
        })
      ).rejects.toThrow();
    });

    it('should handle connection pool errors', async () => {
      mockPool.getClient.mockRejectedValue(new Error('No language server available'));

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          position: { line: 10, character: 8 },
          newName: 'newName',
        })
      ).rejects.toThrow('No language server available');
    });
  });

  describe('Location extraction', () => {
    it('should extract position from middle of location range', async () => {
      const location: Location = {
        uri: 'file:///workspace/file.ts',
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      const workspaceEdit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file.ts': [
            {
              range: location.range,
              newText: 'renamed',
            },
          ],
        },
      };

      mockConnection.sendRequest.mockResolvedValue(workspaceEdit);

      await tool.execute({
        location,
        newName: 'renamed',
      });

      // Should use middle of range as position
      expect(mockConnection.sendRequest).toHaveBeenCalledWith(
        'textDocument/rename',
        expect.objectContaining({
          position: { line: 10, character: 10 }, // Middle of 5-15
        })
      );
    });

    it('should handle single-character location range', async () => {
      const location: Location = {
        uri: 'file:///workspace/file.ts',
        range: {
          start: { line: 5, character: 10 },
          end: { line: 5, character: 11 },
        },
      };

      mockConnection.sendRequest.mockResolvedValue({ changes: {} });

      await tool.execute({
        location,
        newName: 'x',
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith(
        'textDocument/rename',
        expect.objectContaining({
          position: { line: 5, character: 10 },
        })
      );
    });
  });

  describe('Result formatting', () => {
    it('should include diff in result when changes are made', async () => {
      const workspaceEdit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file.ts': [
            {
              range: { start: { line: 0, character: 4 }, end: { line: 0, character: 10 } },
              newText: 'newVar',
            },
          ],
        },
      };

      mockConnection.sendRequest.mockResolvedValue(workspaceEdit);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        position: { line: 0, character: 5 },
        newName: 'newVar',
      });

      expect(result.diff).toBeDefined();
      expect(result.diff).toContain('file.ts');
    });

    it('should provide helpful message when no changes needed', async () => {
      mockConnection.sendRequest.mockResolvedValue({ changes: {} });

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        position: { line: 0, character: 5 },
        newName: 'sameName',
      });

      expect(result.summary.message).toContain('No changes needed');
    });
  });
});
