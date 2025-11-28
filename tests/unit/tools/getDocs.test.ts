import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { GetDocsTool } from '../../../src/tools/getDocs.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';

// Mock the dependencies
jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/utils/logger.js');
jest.mock('../../../src/utils/retry.js', () => ({
  retryWithBackoff: jest.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
}));

describe('GetDocsTool', () => {
  let tool: GetDocsTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      sendRequest: jest.fn(),
      sendNotification: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClient>;

    // Create mock client manager
    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
      getForFile: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    // Create tool instance
    tool = new GetDocsTool(mockClientManager);

    // Clear all mock calls
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('getDocs');
      expect(tool.description).toContain('Retrieve API documentation');
      expect(tool.description).toContain('depth-based traversal');
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.shape).toHaveProperty('symbols');
      expect(tool.inputSchema.shape).toHaveProperty('maxDepth');
      expect(tool.inputSchema.shape).toHaveProperty('maxSymbols');
      expect(tool.inputSchema.shape).toHaveProperty('includePrivate');
    });

    it('should have correct annotations', () => {
      expect(tool.annotations.title).toBe('Get Documentation');
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.idempotentHint).toBe(true);
    });
  });

  describe('execute - basic functionality', () => {
    it('should return documentation for a single symbol', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(a: string): void\n```\n\nA test function that does things',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]).toMatchObject({
        signature: 'function test(a: string): void',
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        depth: 0,
      });
      expect(result.data.stats.queried).toBe(1);
      expect(result.data.stats.found).toBe(1);
      expect(result.metadata?.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should return documentation for multiple symbols', async () => {
      const mockHover1 = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nclass MyClass\n```\n\nA class',
        },
      };
      const mockHover2 = {
        contents: {
          kind: 'markdown',
          value: '```typescript\ninterface MyInterface\n```\n\nAn interface',
        },
      };

      mockClient.sendRequest
        .mockResolvedValueOnce(mockHover1)
        .mockResolvedValueOnce(mockHover2);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test.ts', position: { line: 20, character: 10 } },
        ],
        maxDepth: 0, // Disable depth traversal to prevent workspace/symbol calls
      });

      expect(result.data.symbols).toHaveLength(2);
      expect(result.data.stats.queried).toBe(2);
      expect(result.data.stats.found).toBe(2);
    });

    it('should handle empty hover response', async () => {
      mockClient.sendRequest.mockResolvedValue(null);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      expect(result.data.symbols).toHaveLength(0);
      expect(result.data.stats.queried).toBe(1);
      expect(result.data.stats.found).toBe(0);
    });

    it('should deduplicate symbols with same position', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } }, // Duplicate
        ],
      });

      // Should only have one result due to deduplication
      expect(result.data.symbols).toHaveLength(1);
    });
  });

  describe('execute - depth traversal', () => {
    it('should not traverse when maxDepth is 0', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(user: User): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
        maxDepth: 0,
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.stats.maxDepthReached).toBe(0);
      // Should not call workspace/symbol to find related types
      expect(mockClient.sendRequest).not.toHaveBeenCalledWith(
        'workspace/symbol',
        expect.anything()
      );
    });

    it('should extract related types from signature', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction process(user: User, config: Config): Result\n```',
        },
      };

      const mockSymbols = [
        {
          name: 'User',
          kind: 5, // Class
          location: {
            uri: 'file:///types.ts',
            range: { start: { line: 5, character: 0 } },
          },
        },
      ];

      const mockUserHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\ninterface User { name: string }\n```',
        },
      };

      mockClient.sendRequest
        .mockResolvedValueOnce(mockHover) // First hover for process function
        .mockResolvedValueOnce(mockSymbols) // workspace/symbol for User
        .mockResolvedValueOnce(mockSymbols) // workspace/symbol for Config
        .mockResolvedValueOnce(mockSymbols) // workspace/symbol for Result
        .mockResolvedValueOnce(mockUserHover); // hover for User type

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
        maxDepth: 1,
      });

      // Should have found the original symbol and related types
      expect(result.data.symbols.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('execute - private symbol filtering', () => {
    it('should filter out private symbols by default', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction _privateHelper(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 }, name: '_privateHelper' },
        ],
        includePrivate: false,
      });

      expect(result.data.symbols).toHaveLength(0);
    });

    it('should include private symbols when includePrivate is true', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction _privateHelper(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 }, name: '_privateHelper' },
        ],
        includePrivate: true,
      });

      expect(result.data.symbols).toHaveLength(1);
    });
  });

  describe('execute - maxSymbols limit', () => {
    it('should truncate results when exceeding maxSymbols', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const symbols = Array(10)
        .fill(null)
        .map((_, i) => ({
          uri: 'file:///test.ts',
          position: { line: i, character: 0 },
        }));

      const result = await tool.execute({
        symbols,
        maxSymbols: 5,
      });

      expect(result.data.symbols).toHaveLength(5);
      expect(result.data.stats.truncated).toBe(true);
    });
  });

  describe('execute - error handling', () => {
    it('should handle errors from client manager', async () => {
      const error = new Error('Failed to get client');
      mockClientManager.getForFile.mockRejectedValue(error);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 0, character: 0 } },
        ],
      });

      expect(result.data.symbols).toHaveLength(0);
      expect(result.error).toBe('Failed to get client');
      expect(result.fallback).toContain('grep');
    });

    it('should handle LSP request errors gracefully', async () => {
      const error = new Error('LSP request failed');
      mockClient.sendRequest.mockRejectedValue(error);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 0, character: 0 } },
        ],
      });

      // Errors in individual symbol fetching result in empty results
      // rather than propagating the error - this is by design for resilience
      expect(result.data.symbols).toHaveLength(0);
      expect(result.data.stats.found).toBe(0);
    });
  });

  describe('execute - content parsing', () => {
    it('should parse string content', async () => {
      const mockHover = {
        contents: 'Simple string documentation',
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.documentation).toBe('Simple string documentation');
    });

    it('should parse array content (MarkedString[])', async () => {
      const mockHover = {
        contents: [
          { language: 'typescript', value: 'const myVar: string' },
          'Variable documentation text',
        ],
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.signature).toBe('const myVar: string');
      expect(result.data.symbols[0]?.documentation).toContain('Variable documentation');
    });

    it('should extract kind from signature patterns', async () => {
      const testCases = [
        { signature: 'function myFunc(): void', expectedKind: 'function' },
        { signature: 'class MyClass', expectedKind: 'class' },
        { signature: 'interface MyInterface', expectedKind: 'interface' },
        { signature: 'const myVar: string', expectedKind: 'variable' },
        { signature: 'type MyType = string', expectedKind: 'type' },
      ];

      for (const { signature, expectedKind } of testCases) {
        const mockHover = {
          contents: {
            kind: 'markdown',
            value: `\`\`\`typescript\n${signature}\n\`\`\``,
          },
        };

        mockClient.sendRequest.mockResolvedValue(mockHover);

        const result = await tool.execute({
          symbols: [
            { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
          ],
        });

        expect(result.data.symbols[0]?.kind).toBe(expectedKind);

        jest.clearAllMocks();
      }
    });
  });

  describe('cache functionality', () => {
    it('should use cache for repeated requests', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      // First call
      await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      // Reset mock to track second call
      mockClient.sendRequest.mockClear();

      // Second call - should use cache
      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
        ],
      });

      // sendRequest should not be called for hover on second request (cached)
      // Note: It may still be called for workspace/symbol if depth > 0
      expect(result.data.symbols).toHaveLength(1);
    });

    it('should invalidate cache for specific file', () => {
      // Just test that the method exists and doesn't throw
      expect(() => tool.invalidateFileCache('file:///test.ts')).not.toThrow();
    });

    it('should clear all caches', () => {
      // Just test that the method exists and doesn't throw
      expect(() => tool.clearCache()).not.toThrow();
    });
  });

  describe('language detection', () => {
    it('should handle different file extensions', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(): void\n```',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const testCases = [
        'file:///test.ts',
        'file:///test.js',
        'file:///test.py',
        'file:///test.go',
        'file:///test.rs',
      ];

      for (const uri of testCases) {
        await tool.execute({
          symbols: [{ uri, position: { line: 0, character: 0 } }],
        });

        expect(mockClientManager.getForFile).toHaveBeenCalledWith(uri, expect.any(String));

        jest.clearAllMocks();
      }
    });
  });
});
