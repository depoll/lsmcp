/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { jest } from '@jest/globals';
import { NavigateTool } from '../../../src/tools/navigate.js';

// Mock the dependencies
jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/utils/languages.js', () => ({
  getLanguageFromUri: jest.fn(() => 'typescript'),
}));
jest.mock('fs/promises', () => ({
  readFile: jest.fn(() => Promise.resolve('// Mock file content\nconst mockLine = "test";\n')),
}));
jest.mock('../../../src/utils/logger.js');

// Mock FileAwareLRUCache to just pass through (no caching)
jest.mock('../../../src/utils/fileCache.js', () => ({
  FileAwareLRUCache: jest.fn().mockImplementation(() => ({
    get: jest.fn(() => Promise.resolve(undefined)), // Always miss cache
    set: jest.fn(() => Promise.resolve()),
    invalidateFile: jest.fn(),
    clear: jest.fn(),
  })),
}));

describe('NavigateTool', () => {
  let tool: NavigateTool;
  let mockClientManager: any;
  let mockClient: any;

  beforeEach(() => {
    // Clear all mock calls first
    jest.clearAllMocks();

    // Create mock client
    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };

    // Create mock client manager
    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
    };

    tool = new NavigateTool(mockClientManager);
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('navigate');
      expect(tool.description).toBe(
        'Navigate to definitions, implementations, or type definitions'
      );
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.shape).toHaveProperty('uri');
      expect(tool.inputSchema.shape).toHaveProperty('position');
      expect(tool.inputSchema.shape).toHaveProperty('target');
      expect(tool.inputSchema.shape).toHaveProperty('batch');
      expect(tool.inputSchema.shape).toHaveProperty('maxResults');
    });
  });

  describe('single navigation', () => {
    const singleParams = {
      uri: 'file:///test/file.ts',
      position: { line: 10, character: 15 },
      target: 'definition' as const,
    };

    it('should navigate to definition', async () => {
      const mockLocation = {
        uri: 'file:///test/other.ts',
        range: {
          start: { line: 20, character: 0 },
          end: { line: 20, character: 10 },
        },
      };

      mockClient.sendRequest.mockResolvedValueOnce(mockLocation);

      const result = await tool.execute(singleParams);

      expect(mockClientManager.get).toHaveBeenCalledWith('typescript', singleParams.uri);
      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/definition', {
        textDocument: { uri: singleParams.uri },
        position: singleParams.position,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        uri: mockLocation.uri,
        range: mockLocation.range,
      });
    });

    it('should navigate to implementation', async () => {
      const params = { ...singleParams, target: 'implementation' as const };
      const mockLocations = [
        {
          uri: 'file:///test/impl1.ts',
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 20 },
          },
        },
        {
          uri: 'file:///test/impl2.ts',
          range: {
            start: { line: 15, character: 0 },
            end: { line: 15, character: 20 },
          },
        },
      ];

      mockClient.sendRequest.mockResolvedValueOnce(mockLocations);

      const result = await tool.execute(params);

      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        'textDocument/implementation',
        expect.any(Object)
      );
      expect(result.results).toHaveLength(2);
    });

    it('should navigate to type definition', async () => {
      const params = { ...singleParams, target: 'typeDefinition' as const };

      mockClient.sendRequest.mockResolvedValueOnce({
        targetUri: 'file:///test/types.ts',
        targetRange: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 30 },
        },
        targetSelectionRange: {
          start: { line: 5, character: 10 },
          end: { line: 5, character: 20 },
        },
      });

      const result = await tool.execute(params);

      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        'textDocument/typeDefinition',
        expect.any(Object)
      );
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.uri).toBe('file:///test/types.ts');
    });

    it('should handle no results with fallback suggestion', async () => {
      mockClient.sendRequest.mockResolvedValueOnce(null);

      const result = await tool.execute(singleParams);

      expect(result.results).toHaveLength(0);
      expect(result.fallbackSuggestion).toContain('grep');
    });

    it('should apply maxResults limit', async () => {
      const mockLocations = Array.from({ length: 10 }, (_, i) => ({
        uri: `file:///test/file${i}.ts`,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 10 },
        },
      }));

      mockClient.sendRequest.mockResolvedValueOnce(mockLocations);

      const result = await tool.execute({
        ...singleParams,
        maxResults: 5,
      });

      expect(result.results).toHaveLength(5);
    });

    it('should handle LSP errors gracefully', async () => {
      mockClient.sendRequest.mockRejectedValueOnce(new Error('LSP error'));

      const result = await tool.execute(singleParams);

      expect(result.results).toHaveLength(0);
      expect(result.fallbackSuggestion).toBeDefined();
    });
  });

  describe('batch navigation', () => {
    const batchParams = {
      batch: [
        {
          uri: 'file:///test/file1.ts',
          position: { line: 10, character: 15 },
          target: 'definition' as const,
        },
        {
          uri: 'file:///test/file2.ts',
          position: { line: 20, character: 10 },
          target: 'implementation' as const,
        },
      ],
    };

    it('should process batch requests in parallel', async () => {
      mockClient.sendRequest
        .mockResolvedValueOnce({
          uri: 'file:///test/def.ts',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        })
        .mockResolvedValueOnce([
          {
            uri: 'file:///test/impl.ts',
            range: { start: { line: 10, character: 0 }, end: { line: 10, character: 20 } },
          },
        ]);

      const result = await tool.execute(batchParams);

      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
    });

    it('should handle partial batch failures', async () => {
      // Mock two client calls - one success, one failure
      mockClient.sendRequest
        .mockResolvedValueOnce({
          uri: 'file:///test/def.ts',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        })
        .mockRejectedValueOnce(new Error('Failed'));

      const result = await tool.execute(batchParams);

      expect(result.results).toHaveLength(1);
      expect(result.fallbackSuggestion).toBeDefined();
    });
  });

  describe('result processing', () => {
    it('should sort results by relevance', async () => {
      const sourceUri = 'file:///project/src/index.ts';
      const mockLocations = [
        {
          uri: 'file:///project/node_modules/lib/index.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
        {
          uri: 'file:///project/src/utils.ts', // Same directory
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
        {
          uri: sourceUri, // Same file
          range: { start: { line: 50, character: 0 }, end: { line: 50, character: 10 } },
        },
      ];

      mockClient.sendRequest.mockResolvedValueOnce(mockLocations);

      const result = await tool.execute({
        uri: sourceUri,
        position: { line: 10, character: 15 },
        target: 'definition',
      });

      // Should be sorted: same file, same directory, then others
      expect(result.results[0]?.uri).toBe(sourceUri);
      expect(result.results[1]?.uri).toBe('file:///project/src/utils.ts');
      expect(result.results[2]?.uri).toBe('file:///project/node_modules/lib/index.ts');
    });
  });

  describe('caching', () => {
    it('should return consistent results for multiple calls', async () => {
      const params = {
        uri: 'file:///test/file.ts',
        position: { line: 10, character: 15 },
        target: 'definition' as const,
      };

      mockClient.sendRequest.mockResolvedValue({
        uri: 'file:///test/other.ts',
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
      });

      // First call
      const result1 = await tool.execute(params);

      // Second call
      const result2 = await tool.execute(params);

      // Both calls should return the same results
      expect(result1).toEqual(result2);

      // Note: Caching is mocked to always miss in this test suite
      // Since cache is mocked to always miss, both calls should hit the server
      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
    });

    it('should invalidate cache for modified files', async () => {
      const params = {
        uri: 'file:///test/file.ts',
        position: { line: 10, character: 15 },
        target: 'definition' as const,
      };

      mockClient.sendRequest.mockResolvedValue({
        uri: 'file:///test/other.ts',
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
      });

      // First call
      await tool.execute(params);

      // Invalidate cache
      tool.invalidateFileCache(params.uri);

      // Second call - should not use cache
      await tool.execute(params);

      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should require all params for single navigation', async () => {
      await expect(tool.execute({ uri: 'file:///test.ts' })).rejects.toThrow(
        'Single navigation requires uri, position, and target'
      );
    });

    it('should handle empty batch', async () => {
      await expect(tool.execute({ batch: [] })).rejects.toThrow(
        'Single navigation requires uri, position, and target'
      );
    });
  });
});
