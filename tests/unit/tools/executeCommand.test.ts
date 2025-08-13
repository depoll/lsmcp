import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ExecuteCommandTool } from '../../../src/tools/executeCommand.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import { MCPError, MCPErrorCode } from '../../../src/tools/common-types.js';
import type { MessageConnection } from 'vscode-languageserver-protocol';

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

describe('ExecuteCommandTool', () => {
  let tool: ExecuteCommandTool;
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
        executeCommandProvider: {
          commands: ['editor.action.formatDocument', 'typescript.organizeImports'],
        },
      },
      rootUri: 'file:///workspace',
    } as any;

    // Setup mock pool
    mockPool = {
      get: jest.fn().mockResolvedValue(mockClient),
      getForFile: jest.fn().mockResolvedValue(mockClient),
      getAllActive: jest.fn().mockReturnValue([{ language: 'typescript', client: mockClient }]),
    } as any;

    tool = new ExecuteCommandTool(mockPool);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Parameter validation', () => {
    it('should accept command with optional arguments', async () => {
      mockConnection.sendRequest.mockResolvedValue({ success: true });

      const result = await tool.execute({
        command: 'editor.action.formatDocument',
        arguments: ['file:///workspace/file.ts'],
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('workspace/executeCommand', {
        command: 'editor.action.formatDocument',
        arguments: ['file:///workspace/file.ts'],
      });
      expect(result.data.data.command).toBe('editor.action.formatDocument');
    });

    it('should accept command without arguments', async () => {
      mockConnection.sendRequest.mockResolvedValue(undefined);

      const result = await tool.execute({
        command: 'typescript.organizeImports',
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('workspace/executeCommand', {
        command: 'typescript.organizeImports',
        arguments: undefined,
      });
    });

    it('should accept command with language hint', async () => {
      mockConnection.sendRequest.mockResolvedValue({ formatted: true });

      const result = await tool.execute({
        command: 'typescript.organizeImports',
        language: 'typescript',
      });

      expect(mockPool.getClient).toHaveBeenCalledWith('typescript');
      expect(result.data.data.executedBy).toBe('typescript');
    });

    it('should reject invalid command format', async () => {
      await expect(
        tool.execute({
          command: '',
        })
      ).rejects.toThrow();
    });
  });

  describe('Command execution with specific language', () => {
    it('should use specified language server when language provided', async () => {
      mockConnection.sendRequest.mockResolvedValue({ success: true });

      const result = await tool.execute({
        command: 'custom.command',
        language: 'python',
      });

      expect(mockPool.getClient).toHaveBeenCalledWith('python');
    });

    it('should check command support when language specified', async () => {
      mockClient.capabilities = {
        executeCommandProvider: {
          commands: ['python.runLinter'],
        },
      };

      mockConnection.sendRequest.mockResolvedValue({ linted: true });

      const result = await tool.execute({
        command: 'python.runLinter',
        language: 'python',
      });

      expect(result.data.command).toBe('python.runLinter');
    });

    it('should throw error if command not supported by specified language', async () => {
      mockClient.capabilities = {
        executeCommandProvider: {
          commands: ['python.format'],
        },
      };

      await expect(
        tool.execute({
          command: 'unsupported.command',
          language: 'python',
        })
      ).rejects.toThrow('not supported by python language server');
    });

    it('should throw error if language server has no command support', async () => {
      mockClient.capabilities = {};

      await expect(
        tool.execute({
          command: 'any.command',
          language: 'python',
        })
      ).rejects.toThrow('does not support command execution');
    });
  });

  describe('Command execution across all servers', () => {
    beforeEach(() => {
      const mockConnection2 = {
        sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
      } as any;

      const mockConnection3 = {
        sendRequest: jest.fn().mockResolvedValue({ executed: true }),
      } as any;

      mockPool.getAllActive.mockReturnValue([
        { language: 'typescript', client: { connection: mockConnection } as any },
        { language: 'python', client: { connection: mockConnection2 } as any },
        { language: 'rust', client: { connection: mockConnection3 } as any },
      ]);
    });

    it('should try all servers in parallel when no language specified', async () => {
      // First server rejects, third server succeeds
      mockConnection.sendRequest.mockRejectedValue(new Error('Command not found'));

      const result = await tool.execute({
        command: 'global.command',
      });

      // Should have tried all servers
      expect(mockConnection.sendRequest).toHaveBeenCalled();
      expect(result.data.data.executedBy).toBe('rust');
      expect(result.data.result).toEqual({ executed: true });
    });

    it('should handle timeouts gracefully', async () => {
      // Make first server hang
      mockConnection.sendRequest.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      );

      const result = await tool.execute({
        command: 'slow.command',
      });

      // Should timeout on first server but succeed with third
      expect(result.data.data.executedBy).toBe('rust');
    }, 10000);

    it('should throw error if no server can execute command', async () => {
      mockPool.getAllActive.mockReturnValue([
        {
          language: 'typescript',
          connection: {
            sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
          } as any,
        },
        {
          language: 'python',
          connection: {
            sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
          } as any,
        },
      ]);

      await expect(
        tool.execute({
          command: 'unsupported.command',
        })
      ).rejects.toThrow('not supported by any active language server');
    });

    it('should report failed servers in result', async () => {
      const mockConnection2 = {
        sendRequest: jest.fn().mockRejectedValue(new Error('Internal error')),
      } as any;

      mockPool.getAllActive.mockReturnValue([
        { language: 'typescript', client: { connection: mockConnection } as any },
        { language: 'python', client: { connection: mockConnection2 } as any },
      ]);

      mockConnection.sendRequest.mockResolvedValue({ success: true });

      const result = await tool.execute({
        command: 'test.command',
      });

      expect(result.data.data.executedBy).toBe('typescript');
      expect(result.data.failedServers).toContain('python');
    });
  });

  describe('Error handling', () => {
    it('should handle no active language servers', async () => {
      mockPool.getAllActive.mockReturnValue([]);

      await expect(
        tool.execute({
          command: 'any.command',
        })
      ).rejects.toThrow('No active language servers available');
    });

    it('should handle connection pool errors', async () => {
      mockPool.getClient.mockRejectedValue(new Error('Connection failed'));

      await expect(
        tool.execute({
          command: 'test.command',
          language: 'typescript',
        })
      ).rejects.toThrow('Connection failed');
    });

    it('should handle command execution errors gracefully', async () => {
      mockConnection.sendRequest.mockRejectedValue(new Error('Server crashed'));

      await expect(
        tool.execute({
          command: 'crash.command',
          language: 'typescript',
        })
      ).rejects.toThrow('Failed to execute command');
    });
  });

  describe('Result formatting', () => {
    it('should include command details in result', async () => {
      const commandResult = {
        refactored: true,
        filesChanged: 3,
      };

      mockConnection.sendRequest.mockResolvedValue(commandResult);

      const result = await tool.execute({
        command: 'refactor.all',
        arguments: ['aggressive'],
        language: 'typescript',
      });

      expect(result.data.command).toBe('refactor.all');
      expect(result.data.arguments).toEqual(['aggressive']);
      expect(result.data.result).toEqual(commandResult);
      expect(result.data.data.executedBy).toBe('typescript');
    });

    it('should handle undefined command result', async () => {
      mockConnection.sendRequest.mockResolvedValue(undefined);

      const result = await tool.execute({
        command: 'void.command',
        language: 'typescript',
      });

      expect(result.data.result).toBeUndefined();
      expect(result.data.data.executedBy).toBe('typescript');
    });

    it('should include metadata in result', async () => {
      mockConnection.sendRequest.mockResolvedValue({ done: true });

      const result = await tool.execute({
        command: 'test.command',
        language: 'typescript',
      });

      expect(result).toHaveProperty('command');
      expect(result).toHaveProperty('executedBy');
      expect(result).toHaveProperty('result');
    });
  });

  describe('Parallel execution optimization', () => {
    it('should execute on all servers simultaneously', async () => {
      const startTimes: number[] = [];
      const createMockConnection = (delay: number, shouldSucceed: boolean) => ({
        sendRequest: jest.fn().mockImplementation(async () => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (shouldSucceed) {
            return { success: true };
          }
          throw new Error('Command not found');
        }),
      });

      mockPool.getAllActive.mockReturnValue([
        { language: 'fast', connection: createMockConnection(10, true) as any },
        { language: 'medium', connection: createMockConnection(50, false) as any },
        { language: 'slow', connection: createMockConnection(100, false) as any },
      ]);

      const result = await tool.execute({
        command: 'parallel.test',
      });

      // All servers should start at approximately the same time
      const maxTimeDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxTimeDiff).toBeLessThan(50); // Should start within 50ms of each other

      expect(result.data.data.executedBy).toBe('fast');
    });

    it('should return first successful result immediately', async () => {
      const mockFastConnection = {
        sendRequest: jest.fn().mockResolvedValue({ fast: true }),
      } as any;

      const mockSlowConnection = {
        sendRequest: jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ slow: true }), 5000))
          ),
      } as any;

      mockPool.getAllActive.mockReturnValue([
        { language: 'fast', connection: mockFastConnection },
        { language: 'slow', connection: mockSlowConnection },
      ]);

      const startTime = Date.now();
      const result = await tool.execute({
        command: 'race.test',
      });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete quickly
      expect(result.data.data.executedBy).toBe('fast');
      expect(result.data.result).toEqual({ fast: true });
    });
  });
});
