import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { GetRelatedAPIsTool } from '../../../src/tools/getRelatedAPIs.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { SymbolKind, SymbolInformation, Hover, DocumentSymbol, MarkupKind } from 'vscode-languageserver-protocol';

jest.mock('../../../src/lsp/index.js');

describe('GetRelatedAPIsTool', () => {
  let tool: GetRelatedAPIsTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      sendRequest: jest.fn(),
    };
    
    mockClientManager = new ConnectionPool() as jest.Mocked<ConnectionPool>;
    mockClientManager.getAllActive = jest.fn().mockReturnValue([
      { language: 'typescript', connection: mockClient }
    ]) as any;

    tool = new GetRelatedAPIsTool(mockClientManager);
  });

  it('should extract API docs for a symbol', async () => {
    // 1. workspace/symbol response
    mockClient.sendRequest.mockImplementation((method: string, _params: any) => {
      if (method === 'workspace/symbol') {
        return Promise.resolve([
          {
            name: 'MyClass',
            kind: SymbolKind.Class,
            location: {
              uri: 'file:///src/MyClass.ts',
              range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }
            }
          } as SymbolInformation
        ]);
      }
      if (method === 'textDocument/hover') {
        return Promise.resolve({
          contents: {
            kind: MarkupKind.Markdown,
            value: 'Documentation for MyClass'
          }
        } as Hover);
      }
      if (method === 'textDocument/documentSymbol') {
        return Promise.resolve([
          {
            name: 'MyClass',
            kind: SymbolKind.Class,
            range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            children: [
              {
                name: 'myMethod',
                kind: SymbolKind.Method,
                range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
                selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }
              }
            ]
          } as DocumentSymbol
        ]);
      }
      return Promise.resolve(null);
    });

    const result = await tool.execute({
      symbols: ['MyClass'],
      depth: 1,
      includeReferences: false,
      maxSymbols: 100
    });

    expect(result).toContain('# API Documentation');
    expect(result).toContain('## MyClass (Class)');
    expect(result).toContain('Documentation for MyClass');
    expect(result).toContain('**Members**:');
    expect(result).toContain('- myMethod (Method)');
  });
});
