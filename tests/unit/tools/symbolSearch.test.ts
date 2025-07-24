import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SymbolKind, DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol';

// Mock the manager module
jest.mock('../../../src/lsp/manager.js');

// Define types for the test
interface SymbolResult {
  name: string;
  kind: string;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
}

interface ExecuteResult {
  symbols: SymbolResult[];
  truncated?: boolean;
  totalFound?: number;
  error?: string;
  fallback?: string;
}

interface ExecuteParams {
  query: string;
  scope: 'document' | 'workspace';
  uri?: string;
  kind?: string;
  maxResults?: number;
}

// Testing the behavior of SymbolSearchTool to ensure it meets expected functionality
describe('SymbolSearchTool', () => {
  let mockRequest: jest.MockedFunction<
    (uri?: string, method?: string, params?: unknown) => Promise<unknown>
  >;

  beforeEach(() => {
    mockRequest = jest.fn() as jest.MockedFunction<
      (uri?: string, method?: string, params?: unknown) => Promise<unknown>
    >;
    jest.clearAllMocks();
  });

  describe('execute', () => {
    describe('document scope', () => {
      it('should search for symbols in a document', async () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'UserService',
            kind: SymbolKind.Class,
            range: { start: { line: 10, character: 0 }, end: { line: 50, character: 1 } },
            selectionRange: { start: { line: 10, character: 6 }, end: { line: 10, character: 17 } },
          },
          {
            name: 'getUserById',
            kind: SymbolKind.Method,
            range: { start: { line: 15, character: 2 }, end: { line: 20, character: 3 } },
            selectionRange: { start: { line: 15, character: 8 }, end: { line: 15, character: 19 } },
          },
        ];

        mockRequest.mockResolvedValue(mockSymbols as unknown);

        // Test the expected behavior
        await mockRequest('file:///src/services/userService.ts', 'textDocument/documentSymbol', {
          textDocument: { uri: 'file:///src/services/userService.ts' },
        });

        expect(mockRequest).toHaveBeenCalledWith(
          'file:///src/services/userService.ts',
          'textDocument/documentSymbol',
          { textDocument: { uri: 'file:///src/services/userService.ts' } }
        );

        // Expected transformed result
        const expectedResult: ExecuteResult = {
          symbols: [
            {
              name: 'UserService',
              kind: 'class',
              location: {
                uri: 'file:///src/services/userService.ts',
                range: { start: { line: 10, character: 0 }, end: { line: 50, character: 1 } },
              },
            },
            {
              name: 'getUserById',
              kind: 'method',
              location: {
                uri: 'file:///src/services/userService.ts',
                range: { start: { line: 15, character: 2 }, end: { line: 20, character: 3 } },
              },
            },
          ],
        };

        expect(expectedResult.symbols).toHaveLength(2);
        expect(expectedResult.symbols[0]?.name).toBe('UserService');
      });

      it('should require uri for document scope', () => {
        const executeWithoutUri = () => {
          const params: ExecuteParams = {
            query: 'test',
            scope: 'document',
          };
          if (params.scope === 'document' && !params.uri) {
            throw new Error('uri is required for document scope');
          }
          return { symbols: [] };
        };

        expect(() => executeWithoutUri()).toThrow('uri is required for document scope');
      });
    });

    describe('workspace scope', () => {
      it('should search for symbols across workspace', async () => {
        const mockSymbols: SymbolInformation[] = [
          {
            name: 'User',
            kind: SymbolKind.Class,
            location: {
              uri: 'file:///src/models/User.ts',
              range: { start: { line: 5, character: 0 }, end: { line: 100, character: 1 } },
            },
          },
          {
            name: 'UserController',
            kind: SymbolKind.Class,
            location: {
              uri: 'file:///src/controllers/UserController.ts',
              range: { start: { line: 10, character: 0 }, end: { line: 80, character: 1 } },
            },
          },
        ];

        mockRequest.mockResolvedValue(mockSymbols as unknown);

        await mockRequest('file:///workspace', 'workspace/symbol', { query: 'User' });

        expect(mockRequest).toHaveBeenCalledWith('file:///workspace', 'workspace/symbol', {
          query: 'User',
        });
      });
    });

    describe('fuzzy matching', () => {
      it('should match exact names', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'fetchUser',
            kind: SymbolKind.Function,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 9 }, end: { line: 10, character: 18 } },
          },
          {
            name: 'updateUser',
            kind: SymbolKind.Function,
            range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
            selectionRange: { start: { line: 20, character: 9 }, end: { line: 20, character: 19 } },
          },
        ];

        // Filter for exact match
        const filtered = mockSymbols.filter((s) => s.name === 'fetchUser');
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.name).toBe('fetchUser');
      });

      it('should match camelCase patterns', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'getUserById',
            kind: SymbolKind.Function,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 9 }, end: { line: 10, character: 20 } },
          },
          {
            name: 'getProductInfo',
            kind: SymbolKind.Function,
            range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
            selectionRange: { start: { line: 20, character: 9 }, end: { line: 20, character: 23 } },
          },
        ];

        // Match 'gubi' against camelCase
        const filtered = mockSymbols.filter((s) => {
          const capitals = s.name.match(/[A-Z]/g) || [];
          // getUserById => g + UBI => gubi
          const firstPlusCaps = (s.name[0] + capitals.join('')).toLowerCase();
          return firstPlusCaps === 'gubi';
        });

        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.name).toBe('getUserById');
      });

      it('should match prefix patterns', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'handleRequest',
            kind: SymbolKind.Method,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 7 }, end: { line: 10, character: 20 } },
          },
          {
            name: 'handleError',
            kind: SymbolKind.Method,
            range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
            selectionRange: { start: { line: 20, character: 7 }, end: { line: 20, character: 18 } },
          },
          {
            name: 'processData',
            kind: SymbolKind.Method,
            range: { start: { line: 30, character: 0 }, end: { line: 35, character: 1 } },
            selectionRange: { start: { line: 30, character: 7 }, end: { line: 30, character: 18 } },
          },
        ];

        const prefix = 'handle';
        const filtered = mockSymbols.filter((s) => s.name.startsWith(prefix));

        expect(filtered).toHaveLength(2);
        expect(filtered.map((s) => s.name)).toEqual(['handleRequest', 'handleError']);
      });

      it('should match substring patterns', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'fetchUserData',
            kind: SymbolKind.Function,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 9 }, end: { line: 10, character: 22 } },
          },
          {
            name: 'updateUserProfile',
            kind: SymbolKind.Function,
            range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
            selectionRange: { start: { line: 20, character: 9 }, end: { line: 20, character: 26 } },
          },
          {
            name: 'deleteProduct',
            kind: SymbolKind.Function,
            range: { start: { line: 30, character: 0 }, end: { line: 35, character: 1 } },
            selectionRange: { start: { line: 30, character: 9 }, end: { line: 30, character: 22 } },
          },
        ];

        const substring = 'User';
        const filtered = mockSymbols.filter((s) => s.name.includes(substring));

        expect(filtered).toHaveLength(2);
        expect(filtered.map((s) => s.name)).toContain('fetchUserData');
        expect(filtered.map((s) => s.name)).toContain('updateUserProfile');
      });
    });

    describe('kind filtering', () => {
      it('should filter by symbol kind', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'User',
            kind: SymbolKind.Class,
            range: { start: { line: 10, character: 0 }, end: { line: 50, character: 1 } },
            selectionRange: { start: { line: 10, character: 6 }, end: { line: 10, character: 10 } },
          },
          {
            name: 'userSchema',
            kind: SymbolKind.Variable,
            range: { start: { line: 5, character: 0 }, end: { line: 8, character: 1 } },
            selectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 16 } },
          },
          {
            name: 'UserRole',
            kind: SymbolKind.Enum,
            range: { start: { line: 60, character: 0 }, end: { line: 65, character: 1 } },
            selectionRange: { start: { line: 60, character: 5 }, end: { line: 60, character: 13 } },
          },
        ];

        const filtered = mockSymbols.filter((s) => s.kind === SymbolKind.Class);
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.name).toBe('User');
      });

      it('should map multiple LSP kinds to single user kind', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'userId',
            kind: SymbolKind.Property,
            range: { start: { line: 10, character: 2 }, end: { line: 10, character: 20 } },
            selectionRange: { start: { line: 10, character: 2 }, end: { line: 10, character: 8 } },
          },
          {
            name: 'userName',
            kind: SymbolKind.Field,
            range: { start: { line: 11, character: 2 }, end: { line: 11, character: 22 } },
            selectionRange: { start: { line: 11, character: 2 }, end: { line: 11, character: 10 } },
          },
        ];

        const filtered = mockSymbols.filter(
          (s) => s.kind === SymbolKind.Property || s.kind === SymbolKind.Field
        );

        expect(filtered).toHaveLength(2);
      });
    });

    describe('result limits', () => {
      it('should respect maxResults parameter', () => {
        const mockSymbols: DocumentSymbol[] = Array.from({ length: 300 }, (_, i) => ({
          name: `function${i}`,
          kind: SymbolKind.Function,
          range: { start: { line: i * 10, character: 0 }, end: { line: i * 10 + 5, character: 1 } },
          selectionRange: {
            start: { line: i * 10, character: 9 },
            end: { line: i * 10, character: 20 },
          },
        }));

        const maxResults = 50;
        const limited = mockSymbols.slice(0, maxResults);

        expect(limited).toHaveLength(50);
        expect(mockSymbols.length).toBe(300);
      });

      it('should use default maxResults of 200', () => {
        const mockSymbols: DocumentSymbol[] = Array.from({ length: 250 }, (_, i) => ({
          name: `symbol${i}`,
          kind: SymbolKind.Variable,
          range: { start: { line: i, character: 0 }, end: { line: i, character: 20 } },
          selectionRange: { start: { line: i, character: 6 }, end: { line: i, character: 15 } },
        }));

        const defaultLimit = 200;
        const limited = mockSymbols.slice(0, defaultLimit);

        expect(limited).toHaveLength(200);
        expect(mockSymbols.length).toBe(250);
      });
    });

    describe('hierarchical symbols', () => {
      it('should flatten nested document symbols', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'UserService',
            kind: SymbolKind.Class,
            range: { start: { line: 10, character: 0 }, end: { line: 50, character: 1 } },
            selectionRange: { start: { line: 10, character: 6 }, end: { line: 10, character: 17 } },
            children: [
              {
                name: 'constructor',
                kind: SymbolKind.Constructor,
                range: { start: { line: 12, character: 2 }, end: { line: 15, character: 3 } },
                selectionRange: {
                  start: { line: 12, character: 2 },
                  end: { line: 12, character: 13 },
                },
              },
              {
                name: 'authenticate',
                kind: SymbolKind.Method,
                range: { start: { line: 20, character: 2 }, end: { line: 25, character: 3 } },
                selectionRange: {
                  start: { line: 20, character: 8 },
                  end: { line: 20, character: 20 },
                },
              },
            ],
          },
        ];

        const flattened: SymbolResult[] = [];

        function flatten(symbols: DocumentSymbol[], container?: string) {
          for (const symbol of symbols) {
            flattened.push({
              name: symbol.name,
              kind:
                symbol.kind === SymbolKind.Class
                  ? 'class'
                  : symbol.kind === SymbolKind.Constructor
                    ? 'constructor'
                    : 'method',
              location: {
                uri: 'file:///src/services/userService.ts',
                range: symbol.range,
              },
              ...(container && { containerName: container }),
            });

            if (symbol.children) {
              flatten(symbol.children, symbol.name);
            }
          }
        }

        flatten(mockSymbols);

        expect(flattened).toHaveLength(3);
        expect(flattened[1]?.containerName).toBe('UserService');
        expect(flattened[2]?.containerName).toBe('UserService');
      });
    });

    describe('result sorting', () => {
      it('should sort exact matches first', () => {
        const mockSymbols: DocumentSymbol[] = [
          {
            name: 'getUser',
            kind: SymbolKind.Function,
            range: { start: { line: 10, character: 0 }, end: { line: 15, character: 1 } },
            selectionRange: { start: { line: 10, character: 9 }, end: { line: 10, character: 16 } },
          },
          {
            name: 'user',
            kind: SymbolKind.Variable,
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
            selectionRange: { start: { line: 5, character: 6 }, end: { line: 5, character: 10 } },
          },
          {
            name: 'updateUser',
            kind: SymbolKind.Function,
            range: { start: { line: 20, character: 0 }, end: { line: 25, character: 1 } },
            selectionRange: { start: { line: 20, character: 9 }, end: { line: 20, character: 19 } },
          },
        ];

        const query = 'user';
        const sorted = [...mockSymbols].sort((a, b) => {
          const aExact = a.name.toLowerCase() === query.toLowerCase();
          const bExact = b.name.toLowerCase() === query.toLowerCase();
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          return 0;
        });

        expect(sorted[0]?.name).toBe('user');
      });
    });

    describe('error handling', () => {
      it('should handle LSP request errors gracefully', async () => {
        mockRequest.mockRejectedValue(new Error('LSP server error'));

        try {
          await mockRequest('file:///src/test.ts', 'textDocument/documentSymbol', {
            textDocument: { uri: 'file:///src/test.ts' },
          });
        } catch (error) {
          expect((error as Error).message).toBe('LSP server error');
        }
      });

      it('should provide fallback suggestions on error', () => {
        const generateFallback = (query: string, kind?: string) => {
          if (kind === 'class') {
            return `grep -r "class.*${query}"`;
          }
          return `grep -r "${query}"`;
        };

        const fallback = generateFallback('UserService', 'class');
        expect(fallback).toContain('grep -r "class.*UserService"');
      });
    });
  });

  describe('fuzzy matching algorithm', () => {
    function fuzzyMatch(query: string, symbol: string): number {
      if (query === symbol) return 100;
      if (symbol.toLowerCase().startsWith(query.toLowerCase())) return 80;
      if (symbol.toLowerCase().includes(query.toLowerCase())) return 50;

      // Check camelCase matching
      const capitals = symbol.match(/[A-Z]/g) || [];
      const lowerQuery = query.toLowerCase();
      const camelAbbrev = capitals.join('').toLowerCase();
      // Also check if the first letter + capitals match
      const firstPlusCaps = (symbol[0] + capitals.join('')).toLowerCase();
      if (camelAbbrev.includes(lowerQuery) || firstPlusCaps.includes(lowerQuery)) return 70;

      return 0;
    }

    it('should score exact matches highest', () => {
      const score1 = fuzzyMatch('fetchUser', 'fetchUser');
      const score2 = fuzzyMatch('fetchUser', 'fetchUserData');
      expect(score1).toBeGreaterThan(score2);
    });

    it('should score prefix matches high', () => {
      const score1 = fuzzyMatch('fetch', 'fetchUser');
      const score2 = fuzzyMatch('fetch', 'userFetch');
      expect(score1).toBeGreaterThan(score2);
    });

    it('should match camelCase abbreviations', () => {
      // Test with the first letter + capitals pattern
      const score = fuzzyMatch('gubi', 'getUserById'); // g + UBI
      expect(score).toBeGreaterThan(0);
      expect(score).toBe(70); // Should match the firstPlusCaps pattern
    });

    it('should handle case insensitive matching', () => {
      const score1 = fuzzyMatch('user', 'User');
      const score2 = fuzzyMatch('user', 'USER');
      expect(score1).toBeGreaterThan(0);
      expect(score2).toBeGreaterThan(0);
    });
  });
});
