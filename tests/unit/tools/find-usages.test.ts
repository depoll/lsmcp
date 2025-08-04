import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { FindUsagesTool } from '../../../src/tools/find-usages.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import {
  Location,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  SymbolKind,
} from 'vscode-languageserver-protocol';
import type {
  FindUsagesParams,
  StreamingFindUsagesResult,
} from '../../../src/tools/find-usages.js';

interface MockLSPClient {
  sendRequest: jest.MockedFunction<(method: string, params?: unknown) => Promise<unknown>>;
}

describe('FindUsagesTool', () => {
  let tool: FindUsagesTool;
  let mockPool: jest.Mocked<ConnectionPool>;
  let mockConnection: MockLSPClient;

  const createFindUsagesParams = (overrides: Partial<FindUsagesParams> = {}): FindUsagesParams => ({
    uri: 'file:///test.ts',
    position: { line: 0, character: 0 },
    type: 'references' as const,
    maxResults: 1000,
    maxDepth: 3,
    includeDeclaration: true,
    ...overrides,
  });

  beforeEach(() => {
    mockConnection = {
      sendRequest: jest.fn(),
    };

    mockPool = {
      getForFile: jest.fn().mockImplementation(() => Promise.resolve(mockConnection)),
      disposeConnection: jest.fn(),
      disposeAll: jest.fn(),
      getActiveConnections: jest.fn().mockReturnValue([]),
      healthCheck: jest.fn(),
      registerLanguageServer: jest.fn(),
      get: jest.fn(),
      dispose: jest.fn(),
      getHealth: jest.fn(),
      getDefaultServers: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new FindUsagesTool(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('findUsages');
      expect(tool.description).toBe(`Find symbol references or call hierarchy.

Modes:
- references: All usage locations (read, write, import)
- callHierarchy: Function call flow (incoming/outgoing)

Features: Batch processing, streaming results, deduplication.

Required parameters:
- uri: File URI containing the symbol
- position: Symbol position (line, character)
- type: 'references' or 'callHierarchy'
- maxResults: Maximum results (1-10000)
- maxDepth: Call hierarchy depth (1-10)
- includeDeclaration: Include declaration in references (boolean)`);
    });
  });

  describe('findReferences', () => {
    it('should find references for a symbol', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
        includeDeclaration: true,
      });

      const mockLocations: Location[] = [
        {
          uri: 'file:///test.ts',
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 10 },
          },
        },
        {
          uri: 'file:///other.ts',
          range: {
            start: { line: 20, character: 15 },
            end: { line: 20, character: 20 },
          },
        },
      ];

      mockConnection.sendRequest.mockResolvedValueOnce(mockLocations);

      const result = await tool.execute(params);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const getForFileMock = jest.mocked(mockPool.getForFile);
      const expectedWorkspaceRoot = '/';
      expect(getForFileMock).toHaveBeenCalledWith('file:///test.ts', expectedWorkspaceRoot);
      expect(mockConnection.sendRequest).toHaveBeenCalledWith('textDocument/references', {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 10, character: 5 },
        context: { includeDeclaration: true },
      });

      expect(result.references).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.references).toBeDefined();
      expect(result.references![0]).toMatchObject({
        uri: 'file:///test.ts',
        range: mockLocations[0]!.range,
        kind: 'declaration',
      });
    });

    it('should handle empty references', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
      });

      mockConnection.sendRequest.mockResolvedValueOnce([]);

      const result = await tool.execute(params);

      expect(result.references).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should respect maxResults limit', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
        maxResults: 2,
      });

      const mockLocations: Location[] = Array.from({ length: 5 }, (_, i) => ({
        uri: `file:///file${i}.ts`,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 10 },
        },
      }));

      mockConnection.sendRequest.mockResolvedValueOnce(mockLocations);

      const result = await tool.execute(params);

      expect(result.references).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('callHierarchy', () => {
    it('should find incoming calls', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'callHierarchy',
        direction: 'incoming',
        maxDepth: 2,
      });

      const mockItem: CallHierarchyItem = {
        name: 'myFunction',
        kind: SymbolKind.Function,
        uri: 'file:///test.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 15, character: 0 },
        },
        selectionRange: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      const mockIncomingCalls: CallHierarchyIncomingCall[] = [
        {
          from: {
            name: 'callerFunction',
            kind: SymbolKind.Function,
            uri: 'file:///caller.ts',
            range: {
              start: { line: 20, character: 0 },
              end: { line: 25, character: 0 },
            },
            selectionRange: {
              start: { line: 20, character: 5 },
              end: { line: 20, character: 20 },
            },
          },
          fromRanges: [
            {
              start: { line: 22, character: 10 },
              end: { line: 22, character: 20 },
            },
          ],
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce([mockItem]) // prepareCallHierarchy
        .mockResolvedValueOnce(mockIncomingCalls) // incomingCalls
        .mockResolvedValueOnce([]); // nested incomingCalls

      const result = await tool.execute(params);

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('textDocument/prepareCallHierarchy', {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 10, character: 5 },
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('callHierarchy/incomingCalls', {
        item: mockItem,
      });

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.name).toBe('myFunction');
      expect(result.hierarchy!.calls).toHaveLength(1);
      expect(result.hierarchy!.calls![0]!.name).toBe('callerFunction');
    });

    it('should find outgoing calls', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'callHierarchy',
        direction: 'outgoing',
        maxDepth: 1,
      });

      const mockItem: CallHierarchyItem = {
        name: 'myFunction',
        kind: SymbolKind.Function,
        uri: 'file:///test.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 15, character: 0 },
        },
        selectionRange: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      const mockOutgoingCalls: CallHierarchyOutgoingCall[] = [
        {
          to: {
            name: 'calledFunction',
            kind: SymbolKind.Function,
            uri: 'file:///called.ts',
            range: {
              start: { line: 30, character: 0 },
              end: { line: 35, character: 0 },
            },
            selectionRange: {
              start: { line: 30, character: 5 },
              end: { line: 30, character: 20 },
            },
          },
          fromRanges: [
            {
              start: { line: 12, character: 10 },
              end: { line: 12, character: 25 },
            },
          ],
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce([mockItem]) // prepareCallHierarchy
        .mockResolvedValueOnce(mockOutgoingCalls); // outgoingCalls

      const result = await tool.execute(params);

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('callHierarchy/outgoingCalls', {
        item: mockItem,
      });

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.calls).toHaveLength(1);
      expect(result.hierarchy!.calls![0]!.name).toBe('calledFunction');
    });

    it('should handle no call hierarchy items', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'callHierarchy',
        direction: 'incoming',
      });

      mockConnection.sendRequest.mockResolvedValueOnce([]); // prepareCallHierarchy

      const result = await tool.execute(params);

      expect(result.hierarchy).toBeUndefined();
    });

    it('should avoid infinite recursion in call hierarchy', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'callHierarchy',
        direction: 'incoming',
        maxDepth: 5,
      });

      const mockItem: CallHierarchyItem = {
        name: 'recursiveFunction',
        kind: SymbolKind.Function,
        uri: 'file:///test.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 15, character: 0 },
        },
        selectionRange: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 20 },
        },
      };

      // Create circular reference
      const mockIncomingCalls: CallHierarchyIncomingCall[] = [
        {
          from: mockItem, // Same item calling itself
          fromRanges: [
            {
              start: { line: 12, character: 10 },
              end: { line: 12, character: 25 },
            },
          ],
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce([mockItem]) // prepareCallHierarchy
        .mockResolvedValue(mockIncomingCalls); // All subsequent calls return the same

      const result = await tool.execute(params);

      // Should not result in infinite recursion
      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.calls).toHaveLength(1);
      // The recursive call should be caught and not expanded further
      expect(result.hierarchy!.calls![0]!.calls).toHaveLength(0);
    });
  });

  describe('batch processing', () => {
    it('should process batch requests', async () => {
      const params = createFindUsagesParams({
        position: { line: 0, character: 0 },
        type: 'references',
        batch: [
          { uri: 'file:///test1.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test2.ts', position: { line: 20, character: 10 } },
        ],
      });

      const mockLocations1: Location[] = [
        {
          uri: 'file:///test1.ts',
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 10 },
          },
        },
      ];

      const mockLocations2: Location[] = [
        {
          uri: 'file:///test2.ts',
          range: {
            start: { line: 20, character: 10 },
            end: { line: 20, character: 15 },
          },
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce(mockLocations1)
        .mockResolvedValueOnce(mockLocations2);

      const result = await tool.execute(params);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const getForFileMock = jest.mocked(mockPool.getForFile);
      expect(getForFileMock).toHaveBeenCalledTimes(2);
      expect(result.references).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should deduplicate batch results', async () => {
      const params = createFindUsagesParams({
        position: { line: 0, character: 0 },
        type: 'references',
        batch: [
          { uri: 'file:///test1.ts', position: { line: 10, character: 5 } },
          { uri: 'file:///test2.ts', position: { line: 20, character: 10 } },
        ],
      });

      // Both return the same location
      const duplicateLocation: Location = {
        uri: 'file:///shared.ts',
        range: {
          start: { line: 30, character: 5 },
          end: { line: 30, character: 10 },
        },
      };

      mockConnection.sendRequest
        .mockResolvedValueOnce([duplicateLocation])
        .mockResolvedValueOnce([duplicateLocation]);

      const result = await tool.execute(params);

      expect(result.references).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('streaming', () => {
    it('should stream references', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
      });

      const mockLocations: Location[] = Array.from({ length: 50 }, (_, i) => ({
        uri: `file:///file${i}.ts`,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 10 },
        },
      }));

      mockConnection.sendRequest.mockResolvedValueOnce(mockLocations);

      const results: StreamingFindUsagesResult[] = [];
      for await (const result of tool.stream(params)) {
        results.push(result);
      }

      // Should have progress, partial results, and complete
      expect(results[0]!.type).toBe('progress');
      expect(results[0]!.progress?.message).toBe('Finding references...');

      // Should have batched partial results or just complete if results are small
      const partialResults = results.filter((r) => r.type === 'partial');
      const completeResult = results[results.length - 1];

      // Either we have partial results or we went straight to complete
      if (partialResults.length === 0) {
        // Small result set, went straight to complete
        expect(completeResult!.type).toBe('complete');
      } else {
        // Large result set, had partial results
        expect(partialResults.length).toBeGreaterThan(0);
        expect(completeResult!.type).toBe('complete');
        expect(completeResult!.progress?.total).toBe(50);
      }
    });

    it('should stream call hierarchy', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'callHierarchy',
        direction: 'incoming',
      });

      const mockItem: CallHierarchyItem = {
        name: 'myFunction',
        kind: SymbolKind.Function,
        uri: 'file:///test.ts',
        range: {
          start: { line: 10, character: 0 },
          end: { line: 15, character: 0 },
        },
        selectionRange: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      mockConnection.sendRequest.mockResolvedValueOnce([mockItem]).mockResolvedValueOnce([]); // No incoming calls

      const results: StreamingFindUsagesResult[] = [];
      for await (const result of tool.stream(params)) {
        results.push(result);
      }

      expect(results[0]!.type).toBe('progress');
      expect(results[0]!.progress?.message).toBe('Finding incoming calls...');

      expect(results[1]!.type).toBe('complete');
      expect(results[1]!.data).toBeDefined();
    });

    it('should handle streaming errors', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
      });

      mockConnection.sendRequest.mockRejectedValueOnce(new Error('LSP request failed'));

      const results: StreamingFindUsagesResult[] = [];
      for await (const result of tool.stream(params)) {
        results.push(result);
      }

      const lastResult = results[results.length - 1];
      expect(lastResult!.type).toBe('complete');
      expect(lastResult!.error).toBe('LSP request failed');
    });
  });

  describe('error handling', () => {
    it('should throw on invalid parameters', async () => {
      const invalidParams = {
        uri: 'not-a-url',
        position: { line: -1, character: -1 },
      } as FindUsagesParams;

      await expect(tool.execute(invalidParams)).rejects.toThrow();
    });

    it('should handle LSP errors gracefully', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
      });

      mockConnection.sendRequest.mockRejectedValueOnce(new Error('LSP server error'));

      await expect(tool.execute(params)).rejects.toThrow('LSP server error');
    });

    it('should handle connection pool errors', async () => {
      const params = createFindUsagesParams({
        position: { line: 10, character: 5 },
        type: 'references',
      });

      mockPool.getForFile.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(tool.execute(params)).rejects.toThrow('Connection failed');
    });
  });

  describe('extractWorkspaceDir', () => {
    it('should extract workspace directory from Unix file URI', () => {
      const tool = new FindUsagesTool(mockPool);
      const uri = 'file:///home/user/project/src/file.ts';
      const result = tool.extractWorkspaceDir(uri);
      expect(result).toBe('/home/user/project/src');
    });

    it('should handle root paths', () => {
      const tool = new FindUsagesTool(mockPool);
      const uri = 'file:///file.ts';
      const result = tool.extractWorkspaceDir(uri);
      expect(result).toBe('/');
    });
  });
});
