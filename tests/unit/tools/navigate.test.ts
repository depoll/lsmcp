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
  stat: jest.fn(() => Promise.resolve({ mtimeMs: Date.now() })),
}));
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock FileAwareLRUCache with controllable behavior
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  invalidateFile: jest.fn(),
  clear: jest.fn(),
};

jest.mock('../../../src/utils/fileCache.js', () => ({
  FileAwareLRUCache: jest.fn().mockImplementation(() => mockCache),
}));

describe('NavigateTool', () => {
  let tool: NavigateTool;
  let mockClientManager: any;
  let mockClient: any;

  beforeEach(() => {
    // Clear all mock calls first
    jest.clearAllMocks();

    // Reset cache mock to default behavior (always miss)
    mockCache.get.mockReset();
    mockCache.set.mockReset();
    mockCache.invalidateFile.mockReset();
    mockCache.clear.mockReset();

    (mockCache.get as jest.Mock).mockImplementation(() => Promise.resolve(undefined));
    (mockCache.set as jest.Mock).mockImplementation(() => Promise.resolve());

    // Create mock client
    mockClient = {
      sendRequest: jest.fn(),
      sendNotification: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };

    // Create mock client manager
    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
      getForFile: jest.fn(() => Promise.resolve(mockClient)),
    };

    tool = new NavigateTool(mockClientManager);
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('navigate');
      expect(tool.description).toBe(
        `Navigate to symbol definitions, implementations, or type definitions.

Targets:
- definition: Where symbol is declared
- implementation: Concrete implementations of interfaces/abstract classes
- typeDefinition: Type declarations

Features: Batch support, relevance sorting, grep fallback suggestions.`
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
    // Use platform-appropriate file URLs
    const filePrefix = 'file://';

    const singleParams = {
      uri: `${filePrefix}/test/file.ts`,
      position: { line: 10, character: 15 },
      target: 'definition' as const,
    };

    it('should navigate to definition', async () => {
      const mockLocation = {
        uri: `${filePrefix}/test/other.ts`,
        range: {
          start: { line: 20, character: 0 },
          end: { line: 20, character: 10 },
        },
      };

      mockClient.sendRequest.mockResolvedValueOnce(mockLocation);

      const result = await tool.execute(singleParams);

      expect(mockClientManager.getForFile).toHaveBeenCalledWith(
        singleParams.uri,
        expect.any(String)
      );
      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/definition', {
        textDocument: { uri: singleParams.uri },
        position: singleParams.position,
      });
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]).toMatchObject({
        uri: mockLocation.uri,
        range: mockLocation.range,
      });
    });

    it('should navigate to implementation', async () => {
      const params = { ...singleParams, target: 'implementation' as const };
      const mockLocations = [
        {
          uri: `${filePrefix}/test/impl1.ts`,
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 20 },
          },
        },
        {
          uri: `${filePrefix}/test/impl2.ts`,
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
      expect(result.data.results).toHaveLength(2);
    });

    it('should navigate to type definition', async () => {
      const params = { ...singleParams, target: 'typeDefinition' as const };

      mockClient.sendRequest.mockResolvedValueOnce({
        targetUri: `${filePrefix}/test/types.ts`,
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
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]?.uri).toBe(`${filePrefix}/test/types.ts`);
    });

    it('should handle no results with fallback suggestion', async () => {
      mockClient.sendRequest.mockResolvedValueOnce(null);

      const result = await tool.execute(singleParams);

      expect(result.data.results).toHaveLength(0);
      expect(result.fallback).toContain('grep');
    });

    it('should apply maxResults limit', async () => {
      const mockLocations = Array.from({ length: 10 }, (_, i) => ({
        uri: `${filePrefix}/test/file${i}.ts`,
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

      expect(result.data.results).toHaveLength(5);
    });

    it('should handle LSP errors gracefully', async () => {
      mockClient.sendRequest.mockRejectedValueOnce(new Error('LSP error'));

      const result = await tool.execute(singleParams);

      expect(result.data.results).toHaveLength(0);
      expect(result.fallback).toBeDefined();
    });
  });

  describe('batch navigation', () => {
    // Use platform-appropriate file URLs
    const filePrefix = 'file://';

    const batchParams = {
      batch: [
        {
          uri: `${filePrefix}/test/file1.ts`,
          position: { line: 10, character: 15 },
          target: 'definition' as const,
        },
        {
          uri: `${filePrefix}/test/file2.ts`,
          position: { line: 20, character: 10 },
          target: 'implementation' as const,
        },
      ],
    };

    it('should process batch requests in parallel', async () => {
      mockClient.sendRequest
        .mockResolvedValueOnce({
          uri: `${filePrefix}/test/def.ts`,
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        })
        .mockResolvedValueOnce([
          {
            uri: `${filePrefix}/test/impl.ts`,
            range: { start: { line: 10, character: 0 }, end: { line: 10, character: 20 } },
          },
        ]);

      const result = await tool.execute(batchParams);

      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
      expect(result.data.results).toHaveLength(2);
    });

    it('should handle partial batch failures', async () => {
      // Mock two client calls - one success, one failure
      mockClient.sendRequest
        .mockResolvedValueOnce({
          uri: `${filePrefix}/test/def.ts`,
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        })
        .mockRejectedValueOnce(new Error('Failed'));

      const result = await tool.execute(batchParams);

      expect(result.data.results).toHaveLength(1);
      expect(result.fallback).toBeDefined();
    });
  });

  describe('result processing', () => {
    // Use platform-appropriate file URLs
    const filePrefix = 'file://';

    it('should sort results by relevance', async () => {
      const sourceUri = `${filePrefix}/project/src/index.ts`;
      const mockLocations = [
        {
          uri: `${filePrefix}/project/node_modules/lib/index.ts`,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
        {
          uri: `${filePrefix}/project/src/utils.ts`, // Same directory
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
      expect(result.data.results[0]?.uri).toBe(sourceUri);
      expect(result.data.results[1]?.uri).toBe(`${filePrefix}/project/src/utils.ts`);
      expect(result.data.results[2]?.uri).toBe(`${filePrefix}/project/node_modules/lib/index.ts`);
    });
  });

  describe('caching', () => {
    // Use platform-appropriate file URLs
    const filePrefix = 'file://';

    it('should return consistent results for repeated calls', async () => {
      // Note: Due to ES module mocking limitations, we cannot directly test cache internals.
      // This test verifies that repeated calls return consistent results.
      const params = {
        uri: `${filePrefix}/test/file.ts`,
        position: { line: 10, character: 15 },
        target: 'definition' as const,
      };

      const mockResult = {
        uri: `${filePrefix}/test/other.ts`,
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
      };

      mockClient.sendRequest.mockResolvedValue(mockResult);

      // First call
      const result1 = await tool.execute(params);

      // Second call with same parameters
      const result2 = await tool.execute(params);

      // Results should be consistent
      expect(result1.data.results).toHaveLength(1);
      expect(result2.data.results).toHaveLength(1);
      expect(result1.data.results[0]?.uri).toBe(mockResult.uri);
      expect(result2.data.results[0]?.uri).toBe(mockResult.uri);

      // Note: In this test setup, cache is mocked to always miss,
      // so both calls hit the server. In production, the second call
      // would use cached results.
      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
    });

    it('should have cache invalidation method', async () => {
      // Note: Due to ES module mocking limitations, we cannot directly test cache internals.
      // This test verifies that the invalidation method exists and can be called.
      const params = {
        uri: `${filePrefix}/test/file.ts`,
        position: { line: 10, character: 15 },
        target: 'definition' as const,
      };

      mockClient.sendRequest.mockResolvedValue({
        uri: `${filePrefix}/test/other.ts`,
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
      });

      // First call
      await tool.execute(params);

      // Invalidate cache - this should not throw
      expect(() => tool.invalidateFileCache(params.uri)).not.toThrow();

      // Second call after invalidation
      await tool.execute(params);

      // Both calls should hit the server in this test setup
      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should require all params for single navigation', async () => {
      const result = await tool.execute({ uri: 'file:///test.ts' });
      expect(result.error).toContain('Single navigation requires uri, position, and target');
      expect(result.data.results).toEqual([]);
    });

    it('should handle empty batch', async () => {
      const result = await tool.execute({ batch: [] });
      expect(result.error).toContain('Batch navigation requires at least one navigation request');
      expect(result.data.results).toEqual([]);
    });
  });
});
