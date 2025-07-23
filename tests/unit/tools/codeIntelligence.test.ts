/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CodeIntelligenceTool } from '../../../src/tools/codeIntelligence.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { LSPClientV2 } from '../../../src/lsp/client-v2.js';

// Mock the dependencies
jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/utils/logger.js');

describe('CodeIntelligenceTool', () => {
  let tool: CodeIntelligenceTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClientV2>;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClientV2>;

    // Create mock client manager
    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    // Create tool instance
    tool = new CodeIntelligenceTool(mockClientManager);
  });

  describe('metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('getCodeIntelligence');
      expect(tool.description).toBe('Get hover info, signatures, or completions at a position');
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema.properties).toHaveProperty('uri');
      expect(tool.inputSchema.properties).toHaveProperty('position');
      expect(tool.inputSchema.properties).toHaveProperty('type');
      expect(tool.inputSchema.required).toEqual(['uri', 'position', 'type']);
    });
  });

  describe('hover', () => {
    it('should return hover information', async () => {
      const mockHover = {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction test(): void\n```\n\nA test function',
        },
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'hover',
      });

      expect(result).toEqual({
        type: 'hover',
        content: {
          type: 'function test(): void',
          documentation: 'A test function',
        },
      });

      expect(mockClientManager.get).toHaveBeenCalledWith('typescript', 'file:///test.ts');
      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/hover', {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 10, character: 5 },
      });
    });

    it('should handle empty hover response', async () => {
      mockClient.sendRequest.mockResolvedValue(null);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'hover',
      });

      expect(result).toEqual({
        type: 'hover',
        content: {},
      });
    });

    it('should cache hover results', async () => {
      const mockHover = {
        contents: 'Test hover content',
      };

      mockClient.sendRequest.mockResolvedValue(mockHover);

      const params = {
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'hover' as const,
      };

      // First call
      await tool.execute(params);
      expect(mockClient.sendRequest).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await tool.execute(params);
      expect(mockClient.sendRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('signature help', () => {
    it('should return signature information', async () => {
      const mockSignatureHelp = {
        signatures: [
          {
            label: 'test(arg1: string, arg2: number): void',
            parameters: [
              { label: 'arg1: string', documentation: 'First argument' },
              { label: 'arg2: number', documentation: 'Second argument' },
            ],
            activeParameter: 0,
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      };

      mockClient.sendRequest.mockResolvedValue(mockSignatureHelp);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 15 },
        type: 'signature',
      });

      expect(result).toEqual({
        type: 'signature',
        signatures: [
          {
            label: 'test(arg1: string, arg2: number): void',
            parameters: [
              { label: 'arg1: string', doc: 'First argument' },
              { label: 'arg2: number', doc: 'Second argument' },
            ],
            activeParameter: 0,
          },
        ],
      });
    });

    it('should handle empty signature response', async () => {
      mockClient.sendRequest.mockResolvedValue(null);

      const result = await tool.execute({
        uri: 'file:///test.py',
        position: { line: 10, character: 15 },
        type: 'signature',
      });

      expect(result).toEqual({
        type: 'signature',
        signatures: [],
      });
    });
  });

  describe('completions', () => {
    it('should return filtered completion items', async () => {
      const mockCompletions = {
        items: [
          { label: 'test', kind: 2, detail: 'function test(): void' },
          { label: '_private', kind: 2, detail: 'private function' },
          { label: 'public', kind: 10, detail: 'public property' },
          { label: 'deprecated', kind: 2, deprecated: true },
        ],
      };

      mockClient.sendRequest.mockResolvedValue(mockCompletions);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'completion',
        maxResults: 10,
      });

      expect(result).toEqual({
        type: 'completion',
        items: [
          {
            label: 'test',
            kind: 'method',
            detail: 'function test(): void',
            documentation: undefined,
            insertText: 'test',
          },
          {
            label: 'public',
            kind: 'property',
            detail: 'public property',
            documentation: undefined,
            insertText: 'public',
          },
        ],
      });

      // Should filter out _private and deprecated items
      const completionResult = result as { type: 'completion'; items: unknown[] };
      expect(completionResult.items).toHaveLength(2);
    });

    it('should handle array response format', async () => {
      const mockCompletions = [
        { label: 'getData', kind: 2 },
        { label: 'setData', kind: 3 },
      ];

      mockClient.sendRequest.mockResolvedValue(mockCompletions);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'completion',
      });

      expect(result.type).toBe('completion');
      const completionResult = result as { type: 'completion'; items: unknown[] };
      expect(completionResult.items).toHaveLength(2);
    });

    it('should respect maxResults parameter', async () => {
      const mockCompletions = {
        items: Array(10)
          .fill(null)
          .map((_, i) => ({
            label: `item${i}`,
            kind: 2,
          })),
      };

      mockClient.sendRequest.mockResolvedValue(mockCompletions);

      const result = await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'completion',
        maxResults: 5,
      });

      const completionResult = result as { type: 'completion'; items: unknown[] };
      expect(completionResult.items).toHaveLength(5);
    });

    it('should include completion context when provided', async () => {
      mockClient.sendRequest.mockResolvedValue({ items: [] });

      await tool.execute({
        uri: 'file:///test.ts',
        position: { line: 10, character: 5 },
        type: 'completion',
        completionContext: {
          triggerCharacter: '.',
          triggerKind: 2,
        },
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/completion', {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 10, character: 5 },
        context: {
          triggerKind: 2,
          triggerCharacter: '.',
        },
      });
    });
  });

  describe('language detection', () => {
    it('should detect language from file extension', async () => {
      mockClient.sendRequest.mockResolvedValue(null);

      const testCases = [
        { uri: 'file:///test.ts', expectedLang: 'typescript' },
        { uri: 'file:///test.js', expectedLang: 'javascript' },
        { uri: 'file:///test.py', expectedLang: 'python' },
        { uri: 'file:///test.go', expectedLang: 'go' },
        { uri: 'file:///test.rs', expectedLang: 'rust' },
        { uri: 'file:///test.unknown', expectedLang: 'plaintext' },
      ];

      for (const { uri, expectedLang } of testCases) {
        await tool.execute({
          uri,
          position: { line: 0, character: 0 },
          type: 'hover',
        });

        expect(mockClientManager.get).toHaveBeenCalledWith(expectedLang, uri);
      }
    });
  });

  describe('error handling', () => {
    it('should propagate errors from client manager', async () => {
      const error = new Error('Failed to get client');
      mockClientManager.get.mockRejectedValue(error);

      await expect(
        tool.execute({
          uri: 'file:///test.ts',
          position: { line: 0, character: 0 },
          type: 'hover',
        })
      ).rejects.toThrow('Failed to get client');
    });

    it('should handle LSP request errors', async () => {
      const error = new Error('LSP request failed');
      mockClient.sendRequest.mockRejectedValue(error);

      await expect(
        tool.execute({
          uri: 'file:///test.ts',
          position: { line: 0, character: 0 },
          type: 'hover',
        })
      ).rejects.toThrow('LSP request failed');
    });
  });
});
