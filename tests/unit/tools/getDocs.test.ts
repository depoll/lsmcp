import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { GetDocsTool } from '../../../src/tools/getDocs.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import { SymbolKind } from 'vscode-languageserver-protocol';

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

  // Helper to create mock responses for different LSP requests
  const createMockRequestHandler = (responses: {
    hover?: unknown;
    documentSymbol?: unknown;
    definition?: unknown;
    workspaceSymbol?: unknown;
  }) => {
    return jest.fn((method: string) => {
      switch (method) {
        case 'textDocument/hover':
          return Promise.resolve(responses.hover ?? null);
        case 'textDocument/documentSymbol':
          return Promise.resolve(responses.documentSymbol ?? null);
        case 'textDocument/definition':
          return Promise.resolve(responses.definition ?? null);
        case 'workspace/symbol':
          return Promise.resolve(responses.workspaceSymbol ?? null);
        default:
          return Promise.resolve(null);
      }
    }) as unknown as jest.Mocked<LSPClient>['sendRequest'];
  };

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
    it('should return documentation for a single symbol using LSP', async () => {
      // Mock document symbols to provide kind and name
      const mockDocumentSymbols = [
        {
          name: 'test',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 9 } },
        },
      ];

      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(a: string): void\n```\n\nA test function that does things',
        },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]).toMatchObject({
        name: 'test',
        kind: 'function',
        signature: 'function test(a: string): void',
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        depth: 0,
      });
      expect(result.data.stats.queried).toBe(1);
      expect(result.data.stats.found).toBe(1);
    });

    it('should return documentation for multiple symbols', async () => {
      const mockDocumentSymbols = [
        {
          name: 'MyClass',
          kind: SymbolKind.Class,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 12 } },
        },
        {
          name: 'MyInterface',
          kind: SymbolKind.Interface,
          range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
          selectionRange: { start: { line: 20, character: 10 }, end: { line: 20, character: 21 } },
        },
      ];

      const mockHover1 = {
        contents: { kind: 'markdown', value: '```typescript\nclass MyClass\n```\n\nA class' },
      };
      const mockHover2 = {
        contents: { kind: 'markdown', value: '```typescript\ninterface MyInterface\n```\n\nAn interface' },
      };

      // Create a counter to track calls
      let hoverCallCount = 0;
      mockClient.sendRequest = jest.fn((method: string) => {
        if (method === 'textDocument/documentSymbol') {
          return Promise.resolve(mockDocumentSymbols);
        }
        if (method === 'textDocument/hover') {
          hoverCallCount++;
          return Promise.resolve(hoverCallCount === 1 ? mockHover1 : mockHover2);
        }
        if (method === 'textDocument/definition') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }) as unknown as jest.Mocked<LSPClient>['sendRequest'];

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test.ts', position: { line: 20, character: 10 } },
        ],
        maxDepth: 0,
      });

      expect(result.data.symbols).toHaveLength(2);
      expect(result.data.stats.queried).toBe(2);
      expect(result.data.stats.found).toBe(2);
    });

    it('should handle empty hover response', async () => {
      mockClient.sendRequest = createMockRequestHandler({
        hover: null,
        documentSymbol: [],
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(0);
      expect(result.data.stats.queried).toBe(1);
      expect(result.data.stats.found).toBe(0);
    });

    it('should deduplicate symbols with same position', async () => {
      const mockDocumentSymbols = [
        {
          name: 'test',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 9 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction test(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      const result = await tool.execute({
        symbols: [
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test.ts', position: { line: 10, character: 5 } }, // Duplicate
        ],
      });

      expect(result.data.symbols).toHaveLength(1);
    });
  });

  describe('execute - LSP-based kind extraction', () => {
    it('should use LSP SymbolKind for kind extraction', async () => {
      const testCases = [
        { symbolKind: SymbolKind.Function, expectedKind: 'function' },
        { symbolKind: SymbolKind.Class, expectedKind: 'class' },
        { symbolKind: SymbolKind.Interface, expectedKind: 'interface' },
        { symbolKind: SymbolKind.Variable, expectedKind: 'variable' },
        { symbolKind: SymbolKind.Method, expectedKind: 'method' },
        { symbolKind: SymbolKind.Property, expectedKind: 'property' },
        { symbolKind: SymbolKind.Enum, expectedKind: 'enum' },
        { symbolKind: SymbolKind.Struct, expectedKind: 'struct' },
      ];

      for (const { symbolKind, expectedKind } of testCases) {
        const mockDocumentSymbols = [
          {
            name: 'TestSymbol',
            kind: symbolKind,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
          },
        ];

        const mockHover = {
          contents: { kind: 'markdown', value: '```\nTestSymbol\n```' },
        };

        mockClient.sendRequest = createMockRequestHandler({
          hover: mockHover,
          documentSymbol: mockDocumentSymbols,
          definition: null,
        });

        const result = await tool.execute({
          symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
        });

        expect(result.data.symbols[0]?.kind).toBe(expectedKind);
        expect(result.data.symbols[0]?.name).toBe('TestSymbol');

        jest.clearAllMocks();
      }
    });
  });

  describe('execute - depth traversal with LSP definition', () => {
    it('should find related types via textDocument/definition', async () => {
      const mockDocumentSymbols = [
        {
          name: 'process',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 12 } },
        },
      ];

      const mockDefinition = {
        uri: 'file:///types.ts',
        range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
      };

      const mockRelatedDocSymbols = [
        {
          name: 'User',
          kind: SymbolKind.Interface,
          range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
          selectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 4 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction process(user: User): void\n```' },
      };

      const mockRelatedHover = {
        contents: { kind: 'markdown', value: '```typescript\ninterface User { name: string }\n```' },
      };

      let callCount = 0;
      mockClient.sendRequest = jest.fn((method: string, params: unknown) => {
        if (method === 'textDocument/documentSymbol') {
          const p = params as { textDocument: { uri: string } };
          if (p.textDocument.uri === 'file:///test.ts') {
            return Promise.resolve(mockDocumentSymbols);
          }
          return Promise.resolve(mockRelatedDocSymbols);
        }
        if (method === 'textDocument/hover') {
          callCount++;
          return Promise.resolve(callCount === 1 ? mockHover : mockRelatedHover);
        }
        if (method === 'textDocument/definition') {
          return Promise.resolve(mockDefinition);
        }
        if (method === 'workspace/symbol') {
          return Promise.resolve([
            {
              name: 'User',
              kind: SymbolKind.Interface,
              location: {
                uri: 'file:///types.ts',
                range: { start: { line: 5, character: 0 } },
              },
            },
          ]);
        }
        return Promise.resolve(null);
      }) as unknown as jest.Mocked<LSPClient>['sendRequest'];

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
        maxDepth: 1,
      });

      // Should have found related types
      expect(result.data.symbols.length).toBeGreaterThanOrEqual(1);
      expect(result.data.symbols[0]?.relatedTypes).toBeDefined();
    });
  });

  describe('execute - private symbol filtering', () => {
    it('should filter out private symbols by default', async () => {
      const mockDocumentSymbols = [
        {
          name: '_privateHelper',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 19 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction _privateHelper(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
        includePrivate: false,
      });

      expect(result.data.symbols).toHaveLength(0);
    });

    it('should include private symbols when includePrivate is true', async () => {
      const mockDocumentSymbols = [
        {
          name: '_privateHelper',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 19 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction _privateHelper(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
        includePrivate: true,
      });

      expect(result.data.symbols).toHaveLength(1);
    });
  });

  describe('execute - maxSymbols limit', () => {
    it('should truncate results when exceeding maxSymbols', async () => {
      const mockDocumentSymbols = Array(10)
        .fill(null)
        .map((_, i) => ({
          name: `symbol${i}`,
          kind: SymbolKind.Function,
          range: { start: { line: i, character: 0 }, end: { line: i + 5, character: 1 } },
          selectionRange: { start: { line: i, character: 0 }, end: { line: i, character: 10 } },
        }));

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction test(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      const symbols = Array(10)
        .fill(null)
        .map((_, i) => ({ uri: 'file:///test.ts', position: { line: i, character: 0 } }));

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
        symbols: [{ uri: 'file:///test.ts', position: { line: 0, character: 0 } }],
      });

      expect(result.data.symbols).toHaveLength(0);
      expect(result.error).toBe('Failed to get client');
      expect(result.fallback).toContain('grep');
    });

    it('should handle LSP request errors gracefully', async () => {
      const error = new Error('LSP request failed');
      mockClient.sendRequest.mockRejectedValue(error);

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 0, character: 0 } }],
      });

      expect(result.data.symbols).toHaveLength(0);
      expect(result.data.stats.found).toBe(0);
    });
  });

  describe('execute - content parsing', () => {
    it('should parse string content', async () => {
      mockClient.sendRequest = createMockRequestHandler({
        hover: { contents: 'Simple string documentation' },
        documentSymbol: [],
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.documentation).toBe('Simple string documentation');
    });

    it('should parse array content (MarkedString[])', async () => {
      mockClient.sendRequest = createMockRequestHandler({
        hover: {
          contents: [
            { language: 'typescript', value: 'const myVar: string' },
            'Variable documentation text',
          ],
        },
        documentSymbol: [],
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.signature).toBe('const myVar: string');
      expect(result.data.symbols[0]?.documentation).toContain('Variable documentation');
    });

    it('should fall back to signature parsing when LSP documentSymbol is empty', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction myFunc(): void\n```\n\nA function',
        },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: [], // Empty - will fall back to signature parsing
        definition: null,
      });

      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.kind).toBe('function');
      expect(result.data.symbols[0]?.name).toBe('myFunc');
    });
  });

  describe('cache functionality', () => {
    it('should use cache for repeated requests', async () => {
      const mockDocumentSymbols = [
        {
          name: 'test',
          kind: SymbolKind.Function,
          range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
          selectionRange: { start: { line: 10, character: 5 }, end: { line: 10, character: 9 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```typescript\nfunction test(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

      // First call
      await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      // Second call - should use cache
      const result = await tool.execute({
        symbols: [{ uri: 'file:///test.ts', position: { line: 10, character: 5 } }],
      });

      expect(result.data.symbols).toHaveLength(1);
    });

    it('should invalidate cache for specific file', () => {
      expect(() => tool.invalidateFileCache('file:///test.ts')).not.toThrow();
    });

    it('should clear all caches', () => {
      expect(() => tool.clearCache()).not.toThrow();
    });
  });

  describe('language detection', () => {
    it('should handle different file extensions', async () => {
      const mockDocumentSymbols = [
        {
          name: 'test',
          kind: SymbolKind.Function,
          range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
      ];

      const mockHover = {
        contents: { kind: 'markdown', value: '```\nfunction test(): void\n```' },
      };

      mockClient.sendRequest = createMockRequestHandler({
        hover: mockHover,
        documentSymbol: mockDocumentSymbols,
        definition: null,
      });

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
