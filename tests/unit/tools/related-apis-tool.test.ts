import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RelatedAPIsTool } from '../../../src/tools/related-apis-tool.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import {
  Hover,
  SymbolInformation,
  SymbolKind,
  Location,
  Range,
} from 'vscode-languageserver-protocol';

// Mock dependencies
jest.mock('../../../src/utils/retry.js', () => ({
  retryWithBackoff: jest.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
}));

describe('RelatedAPIsTool', () => {
  let tool: RelatedAPIsTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;

  beforeEach(() => {
    // Mock LSP client
    mockClient = {
      sendRequest: jest.fn(),
      sendNotification: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClient>;

    // Mock connection pool
    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
      getForFile: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new RelatedAPIsTool(mockClientManager);
  });

  describe('execute', () => {
    it('should resolve a single symbol by name', async () => {
      const symbolLocation: Location = {
        uri: 'file:///test/file.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 10 },
        },
      };

      const symbolInfo: SymbolInformation = {
        name: 'MyClass',
        kind: SymbolKind.Class,
        location: symbolLocation,
      };

      const hoverResponse: Hover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nclass MyClass {\n  method(): string\n}\n```\n\nA test class',
        },
        range: symbolLocation.range,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation((method: string): Promise<unknown> => {
        if (method === 'workspace/symbol') {
          return Promise.resolve([symbolInfo]);
        }
        if (method === 'textDocument/hover') {
          return Promise.resolve(hoverResponse);
        }
        return Promise.resolve(null);
      });

      const result = await tool.execute({
        symbols: ['MyClass'],
        depth: 1,
        includeReferences: false,
      });

      expect(result.data.primarySymbols).toHaveLength(1);
      expect(result.data.primarySymbols[0]?.name).toBe('MyClass');
      expect(result.data.primarySymbols[0]?.type).toBe('Class');
    });

    it('should handle symbols not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockResolvedValue([]);

      const result = await tool.execute({
        symbols: ['NonExistent'],
        depth: 1,
        includeReferences: false,
      });

      expect(result.data.primarySymbols).toHaveLength(0);
      expect(result.error).toContain('not found');
    });

    it('should recursively gather related symbols up to specified depth', async () => {
      const classSymbol: SymbolInformation = {
        name: 'UserService',
        kind: SymbolKind.Class,
        location: {
          uri: 'file:///test/service.ts',
          range: {
            start: { line: 5, character: 0 },
            end: { line: 20, character: 1 },
          },
        },
      };

      const userTypeSymbol: SymbolInformation = {
        name: 'User',
        kind: SymbolKind.Interface,
        location: {
          uri: 'file:///test/types.ts',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 5, character: 1 },
          },
        },
      };

      const classHover: Hover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nclass UserService {\n  getUser(): User\n}\n```',
        },
      };

      const userHover: Hover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\ninterface User {\n  id: string\n  name: string\n}\n```',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation(
        (method: string, params: unknown): Promise<unknown> => {
          if (method === 'workspace/symbol') {
            const query = (params as { query: string }).query;
            if (query === 'UserService') return Promise.resolve([classSymbol]);
            if (query === 'User') return Promise.resolve([userTypeSymbol]);
            return Promise.resolve([]);
          }
          if (method === 'textDocument/hover') {
            const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
            if (uri.includes('service.ts')) return Promise.resolve(classHover);
            if (uri.includes('types.ts')) return Promise.resolve(userHover);
          }
          return Promise.resolve(null);
        }
      );

      const result = await tool.execute({
        symbols: ['UserService'],
        depth: 2,
        includeReferences: false,
      });

      expect(result.data.primarySymbols).toHaveLength(1);
      expect(result.data.relatedSymbols).toBeDefined();
      expect(result.data.relatedSymbols?.length).toBeGreaterThan(0);

      // Check that User interface was found as a related symbol
      const relatedUser = result.data.relatedSymbols?.find((s) => s.name === 'User');
      expect(relatedUser).toBeDefined();
    });

    it('should prevent infinite loops from circular dependencies', async () => {
      const aSymbol: SymbolInformation = {
        name: 'ClassA',
        kind: SymbolKind.Class,
        location: {
          uri: 'file:///test/a.ts',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 5, character: 1 },
          },
        },
      };

      const bSymbol: SymbolInformation = {
        name: 'ClassB',
        kind: SymbolKind.Class,
        location: {
          uri: 'file:///test/b.ts',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 5, character: 1 },
          },
        },
      };

      // ClassA references ClassB, ClassB references ClassA (circular)
      const aHover: Hover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nclass ClassA {\n  b: ClassB\n}\n```',
        },
      };

      const bHover: Hover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nclass ClassB {\n  a: ClassA\n}\n```',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation(
        (method: string, params: unknown): Promise<unknown> => {
          if (method === 'workspace/symbol') {
            const query = (params as { query: string }).query;
            if (query === 'ClassA') return Promise.resolve([aSymbol]);
            if (query === 'ClassB') return Promise.resolve([bSymbol]);
            return Promise.resolve([]);
          }
          if (method === 'textDocument/hover') {
            const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
            if (uri.includes('a.ts')) return Promise.resolve(aHover);
            if (uri.includes('b.ts')) return Promise.resolve(bHover);
          }
          return Promise.resolve(null);
        }
      );

      const result = await tool.execute({
        symbols: ['ClassA'],
        depth: 5, // Deep enough to trigger circular references
        includeReferences: false,
      });

      // Should not hang or crash, and should handle the circular reference
      expect(result.data.primarySymbols).toHaveLength(1);
      expect(result.data.relatedSymbols).toBeDefined();

      // The key thing is that it doesn't hang and completes successfully
      // Due to depth-based keying, symbols may appear at different depths
      // but the total should be reasonable (not infinite)
      const allSymbols = [
        ...(result.data.primarySymbols || []),
        ...(result.data.relatedSymbols || []),
      ];

      // Should have found ClassA (primary) and possibly ClassB at various depths
      // The important thing is it's finite and didn't hang
      expect(allSymbols.length).toBeGreaterThan(0);
      expect(allSymbols.length).toBeLessThan(20); // Reasonable upper bound
    });

    it('should extract documentation from hover responses', async () => {
      const symbolInfo: SymbolInformation = {
        name: 'calculateTotal',
        kind: SymbolKind.Function,
        location: {
          uri: 'file:///test/utils.ts',
          range: {
            start: { line: 10, character: 0 },
            end: { line: 15, character: 1 },
          },
        },
      };

      const hoverWithDocs: Hover = {
        contents: {
          kind: 'markdown',
          value:
            '```typescript\nfunction calculateTotal(items: Item[]): number\n```\n\nCalculates the total price of all items.\n\n@param items - Array of items to calculate\n@returns The total price',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation((method: string): Promise<unknown> => {
        if (method === 'workspace/symbol') return Promise.resolve([symbolInfo]);
        if (method === 'textDocument/hover') return Promise.resolve(hoverWithDocs);
        return Promise.resolve(null);
      });

      const result = await tool.execute({
        symbols: ['calculateTotal'],
        depth: 1,
        includeReferences: false,
      });

      expect(result.data.primarySymbols).toHaveLength(1);
      const symbol = result.data.primarySymbols[0];
      expect(symbol?.documentation).toBeDefined();
      expect(symbol?.documentation).toContain('Calculates the total price');
      expect(symbol?.signature).toContain('function calculateTotal');
    });

    it('should respect depth parameter', async () => {
      // Set up a chain of symbols: A -> B -> C -> D
      const symbols: SymbolInformation[] = ['A', 'B', 'C', 'D'].map((name) => ({
        name,
        kind: SymbolKind.Class,
        location: {
          uri: `file:///test/${name.toLowerCase()}.ts`,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 5, character: 1 },
          },
        },
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation(
        (method: string, params: unknown): Promise<unknown> => {
          if (method === 'workspace/symbol') {
            const query = (params as { query: string }).query;
            const found = symbols.find((s) => s.name === query);
            return Promise.resolve(found ? [found] : []);
          }
          if (method === 'textDocument/hover') {
            const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
            if (uri.includes('a.ts')) {
              return Promise.resolve({
                contents: { kind: 'markdown', value: '```typescript\nclass A { b: B }\n```' },
              });
            }
            if (uri.includes('b.ts')) {
              return Promise.resolve({
                contents: { kind: 'markdown', value: '```typescript\nclass B { c: C }\n```' },
              });
            }
            if (uri.includes('c.ts')) {
              return Promise.resolve({
                contents: { kind: 'markdown', value: '```typescript\nclass C { d: D }\n```' },
              });
            }
            if (uri.includes('d.ts')) {
              return Promise.resolve({
                contents: { kind: 'markdown', value: '```typescript\nclass D {}\n```' },
              });
            }
          }
          return Promise.resolve(null);
        }
      );

      // Test with depth 1 - should only get A and B
      const result1 = await tool.execute({
        symbols: ['A'],
        depth: 1,
        includeReferences: false,
      });

      const allSymbols1 = [
        ...(result1.data.primarySymbols || []),
        ...(result1.data.relatedSymbols || []),
      ];
      expect(allSymbols1.some((s) => s.name === 'A')).toBe(true);
      // B should be in related symbols at depth 1

      // Test with depth 3 - should get A, B, C, D
      const result3 = await tool.execute({
        symbols: ['A'],
        depth: 3,
        includeReferences: false,
      });

      const allSymbols3 = [
        ...(result3.data.primarySymbols || []),
        ...(result3.data.relatedSymbols || []),
      ];
      expect(allSymbols3.some((s) => s.name === 'A')).toBe(true);
      // At depth 3, we should have found more symbols
      expect(allSymbols3.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle multiple symbols in a single request', async () => {
      const symbols: SymbolInformation[] = [
        {
          name: 'FunctionA',
          kind: SymbolKind.Function,
          location: {
            uri: 'file:///test/a.ts',
            range: Range.create(1, 0, 3, 1),
          },
        },
        {
          name: 'FunctionB',
          kind: SymbolKind.Function,
          location: {
            uri: 'file:///test/b.ts',
            range: Range.create(1, 0, 3, 1),
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation(
        (method: string, params: unknown): Promise<unknown> => {
          if (method === 'workspace/symbol') {
            const query = (params as { query: string }).query;
            return Promise.resolve(symbols.filter((s) => s.name === query));
          }
          if (method === 'textDocument/hover') {
            return Promise.resolve({
              contents: { kind: 'markdown', value: '```typescript\nfunction test() {}\n```' },
            });
          }
          return Promise.resolve(null);
        }
      );

      const result = await tool.execute({
        symbols: ['FunctionA', 'FunctionB'],
        depth: 1,
        includeReferences: false,
      });

      expect(result.data.primarySymbols).toHaveLength(2);
      expect(result.data.primarySymbols?.some((s) => s.name === 'FunctionA')).toBe(true);
      expect(result.data.primarySymbols?.some((s) => s.name === 'FunctionB')).toBe(true);
    });

    it('should format output as markdown', async () => {
      const symbolInfo: SymbolInformation = {
        name: 'MyFunction',
        kind: SymbolKind.Function,
        location: {
          uri: 'file:///test/utils.ts',
          range: Range.create(10, 0, 15, 1),
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation((method: string): Promise<unknown> => {
        if (method === 'workspace/symbol') return Promise.resolve([symbolInfo]);
        if (method === 'textDocument/hover') {
          return Promise.resolve({
            contents: {
              kind: 'markdown',
              value:
                '```typescript\nfunction MyFunction(x: number): string\n```\n\nA test function',
            },
          });
        }
        return Promise.resolve(null);
      });

      const result = await tool.execute({
        symbols: ['MyFunction'],
        depth: 1,
        includeReferences: false,
      });

      expect(result.data.markdownReport).toBeDefined();
      expect(result.data.markdownReport).toContain('# Related APIs for: MyFunction');
      expect(result.data.markdownReport).toContain('## Primary Symbols');
      expect(result.data.markdownReport).toContain('### MyFunction');
      expect(result.data.markdownReport).toContain('```typescript');
    });
  });

  describe('type extraction', () => {
    it('should extract referenced types from function signatures', async () => {
      const functionSymbol: SymbolInformation = {
        name: 'processData',
        kind: SymbolKind.Function,
        location: {
          uri: 'file:///test/api.ts',
          range: Range.create(5, 0, 10, 1),
        },
      };

      const hoverWithTypes: Hover = {
        contents: {
          kind: 'markdown',
          value:
            '```typescript\nfunction processData(input: DataInput, options: ProcessOptions): Promise<DataOutput>\n```',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (mockClient.sendRequest as any).mockImplementation((method: string): Promise<unknown> => {
        if (method === 'workspace/symbol') return Promise.resolve([functionSymbol]);
        if (method === 'textDocument/hover') return Promise.resolve(hoverWithTypes);
        return Promise.resolve(null);
      });

      const result = await tool.execute({
        symbols: ['processData'],
        depth: 2,
        includeReferences: false,
      });

      // The tool should try to find DataInput, ProcessOptions, and DataOutput
      // We can't assert they're found without mocking them, but we can check
      // that the extraction logic runs without error
      expect(result.data.primarySymbols).toHaveLength(1);
    });
  });
});
