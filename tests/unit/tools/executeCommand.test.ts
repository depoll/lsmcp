import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ExecuteCommandTool } from '../../../src/tools/executeCommand.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
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
    } as unknown as jest.Mocked<MessageConnection>;

    // Setup mock client with sendRequest method
    mockClient = {
      connection: mockConnection,
      sendRequest: mockConnection.sendRequest,
      getCapabilities: jest.fn().mockReturnValue({
        executeCommandProvider: {
          commands: ['editor.action.formatDocument', 'typescript.organizeImports'],
        },
      }),
      rootUri: 'file:///workspace',
    } as unknown as jest.Mocked<LSPClient>;

    // Setup mock pool
    mockPool = {
      // @ts-expect-error - Mock types don't perfectly match
      get: jest.fn().mockResolvedValue(mockClient),
      // @ts-expect-error - Mock types don't perfectly match
      getForFile: jest.fn().mockResolvedValue(mockClient),
      getAllActive: jest.fn().mockReturnValue([{ language: 'typescript', connection: mockClient }]),
    } as unknown as jest.Mocked<ConnectionPool>;

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
      expect(result.data.command).toBe('editor.action.formatDocument');
    });

    it('should accept command without arguments', async () => {
      mockConnection.sendRequest.mockResolvedValue(undefined);

      await tool.execute({
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

      expect(mockPool.get).toHaveBeenCalledWith('typescript', expect.any(String));
      expect(result.data.executedBy).toBe('typescript');
    });

    it('should handle empty command gracefully', async () => {
      mockConnection.sendRequest.mockResolvedValue(undefined);

      const result = await tool.execute({
        command: '',
      });

      expect(result.data.command).toBe('');
    });
  });

  describe('Command execution with specific language', () => {
    it('should use specified language server when language provided', async () => {
      mockConnection.sendRequest.mockResolvedValue({ success: true });

      await tool.execute({
        command: 'custom.command',
        language: 'python',
      });

      expect(mockPool.get).toHaveBeenCalledWith('python', expect.any(String));
    });

    it('should check command support when language specified', async () => {
      mockClient.getCapabilities.mockReturnValue({
        executeCommandProvider: {
          commands: ['python.runLinter'],
        },
      });

      mockConnection.sendRequest.mockResolvedValue({ linted: true });

      const result = await tool.execute({
        command: 'python.runLinter',
        language: 'python',
      });

      expect(result.data.command).toBe('python.runLinter');
    });

    it('should execute command even if not listed in capabilities', async () => {
      mockClient.getCapabilities.mockReturnValue({
        executeCommandProvider: {
          commands: ['python.format'],
        },
      });

      mockConnection.sendRequest.mockResolvedValue(undefined);

      const result = await tool.execute({
        command: 'unsupported.command',
        language: 'python',
      });

      expect(result.data.command).toBe('unsupported.command');
    });

    it('should execute command even without executeCommandProvider', async () => {
      mockClient.getCapabilities.mockReturnValue({});

      mockConnection.sendRequest.mockResolvedValue({ executed: true });

      const result = await tool.execute({
        command: 'any.command',
        language: 'python',
      });

      expect(result.data.command).toBe('any.command');
      expect(result.data.result).toEqual({ executed: true });
    });
  });

  describe('Command execution across all servers', () => {
    beforeEach(() => {
      const mockConnection2 = {
        // @ts-expect-error - Mock function typing
        sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
      } as unknown as jest.Mocked<MessageConnection>;

      const mockConnection3 = {
        // @ts-expect-error - Mock function typing
        sendRequest: jest.fn().mockResolvedValue({ executed: true }),
      } as unknown as jest.Mocked<MessageConnection>;

      mockPool.getAllActive.mockReturnValue([
        {
          language: 'typescript',
          connection: { sendRequest: mockConnection.sendRequest } as unknown as LSPClient,
        },
        {
          language: 'python',
          connection: { sendRequest: mockConnection2.sendRequest } as unknown as LSPClient,
        },
        {
          language: 'rust',
          connection: { sendRequest: mockConnection3.sendRequest } as unknown as LSPClient,
        },
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
      expect(result.data.executedBy).toBe('rust');
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
      expect(result.data.executedBy).toBe('rust');
    }, 10000);

    it('should throw error if no server can execute command', async () => {
      mockPool.getAllActive.mockReturnValue([
        {
          language: 'typescript',
          connection: {
            // @ts-expect-error - Mock function typing
            sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
          } as unknown as LSPClient,
        },
        {
          language: 'python',
          connection: {
            // @ts-expect-error - Mock function typing
            sendRequest: jest.fn().mockRejectedValue(new Error('Command not found')),
          } as unknown as LSPClient,
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
        // @ts-expect-error - Mock function typing
        sendRequest: jest.fn().mockRejectedValue(new Error('Internal error')),
      } as unknown as jest.Mocked<MessageConnection>;

      mockPool.getAllActive.mockReturnValue([
        {
          language: 'typescript',
          connection: { sendRequest: mockConnection.sendRequest } as unknown as LSPClient,
        },
        {
          language: 'python',
          connection: { sendRequest: mockConnection2.sendRequest } as unknown as LSPClient,
        },
      ]);

      mockConnection.sendRequest.mockResolvedValue({ success: true });

      const result = await tool.execute({
        command: 'test.command',
      });

      expect(result.data.executedBy).toBe('typescript');
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
      mockPool.get.mockRejectedValue(new Error('Connection failed'));

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
      expect(result.data.executedBy).toBe('typescript');
    });

    it('should handle undefined command result', async () => {
      mockConnection.sendRequest.mockResolvedValue(undefined);

      const result = await tool.execute({
        command: 'void.command',
        language: 'typescript',
      });

      expect(result.data.result).toBeUndefined();
      expect(result.data.executedBy).toBe('typescript');
    });

    it('should include metadata in result', async () => {
      mockConnection.sendRequest.mockResolvedValue({ done: true });

      const result = await tool.execute({
        command: 'test.command',
        language: 'typescript',
      });

      expect(result.data).toHaveProperty('command');
      expect(result.data).toHaveProperty('executedBy');
      expect(result.data).toHaveProperty('result');
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
        { language: 'fast', connection: createMockConnection(10, true) as unknown as LSPClient },
        { language: 'medium', connection: createMockConnection(50, false) as unknown as LSPClient },
        { language: 'slow', connection: createMockConnection(100, false) as unknown as LSPClient },
      ]);

      const result = await tool.execute({
        command: 'parallel.test',
      });

      // All servers should start at approximately the same time
      const maxTimeDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxTimeDiff).toBeLessThan(50); // Should start within 50ms of each other

      expect(result.data.executedBy).toBe('fast');
    });

    it('should return first successful result with timeout', async () => {
      const mockFastConnection = {
        // @ts-expect-error - Mock function typing
        sendRequest: jest.fn().mockResolvedValue({ fast: true }),
      } as unknown as LSPClient;

      const mockSlowConnection = {
        sendRequest: jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ slow: true }), 5000))
          ),
      } as unknown as LSPClient;

      mockPool.getAllActive.mockReturnValue([
        { language: 'fast', connection: mockFastConnection },
        { language: 'slow', connection: mockSlowConnection },
      ]);

      const startTime = Date.now();
      const result = await tool.execute({
        command: 'race.test',
      });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(4000); // Should complete within timeout
      expect(result.data.executedBy).toBe('fast');
      expect(result.data.result).toEqual({ fast: true });
    });
  });
});
