import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SymbolContextTool } from '../../../src/tools/symbolContext.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { promises as fs } from 'fs';

jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/utils/logger.js');

describe('SymbolContextTool', () => {
  let tool: SymbolContextTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;

  beforeEach(() => {
    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClient>;

    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
      getForFile: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new SymbolContextTool(mockClientManager);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return a full symbol context', async () => {
    // Mock responses
    const mockHover = {
      contents: {
        kind: 'markdown',
        value: '```typescript\nfunction MyClass.myMethod(arg: string): number\n```\n\nDocs for myMethod.',
      },
    };
    const mockSignatureHelp = {
      signatures: [
        {
          label: 'myMethod(arg: string): number',
          parameters: [{ label: 'arg: string', documentation: 'An argument.' }],
        },
      ],
    };
    const mockReferences = [
      {
        uri: 'file:///test.ts',
        range: { start: { line: 20, character: 10 }, end: { line: 20, character: 18 } },
      },
    ];
    const mockDocumentSymbols = [
      {
        name: 'MyClass',
        kind: SymbolKind.Class,
        range: { start: { line: 0, character: 0 }, end: { line: 7, character: 1 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        children: [
          {
            name: 'myMethod',
            kind: SymbolKind.Method,
            range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 10 } },
            children: [],
          },
          {
            name: 'otherMethod',
            kind: SymbolKind.Method,
            range: { start: { line: 4, character: 2 }, end: { line: 6, character: 3 } },
            selectionRange: { start: { line: 4, character: 2 }, end: { line: 4, character: 13 } },
            children: [],
          },
        ],
      },
    ];

    jest.spyOn(fs, 'readFile').mockResolvedValue([
      'class MyClass {',
      '  myMethod(arg: string): number {',
      '    return 1;',
      '  }',
      '  otherMethod(): void {',
      '    // do something',
      '  }',
      '}',
    ].join('\n'));

    // The order of resolved values should match the order in Promise.allSettled
    mockClient.sendRequest
      .mockResolvedValueOnce(mockHover) // hover
      .mockResolvedValueOnce(mockSignatureHelp) // signatureHelp
      .mockResolvedValueOnce(mockReferences) // references
      .mockResolvedValueOnce(mockDocumentSymbols); // documentSymbol

    const result = await tool.execute({
      uri: 'file:///test.ts',
      position: { line: 1, character: 10 },
    });

    expect(result.data.symbol?.name).toBe('MyClass.myMethod');
    expect(result.data.signature?.label).toContain('myMethod');
    expect(result.data.references).toHaveLength(1);
    expect(result.data.surroundings?.containerName).toBe('MyClass');
    expect(result.data.surroundings?.symbols).toHaveLength(1);
    expect(result.data.surroundings?.symbols[0]?.name).toBe('otherMethod');
    expect(result.data.surroundings?.symbols[0]?.code).toContain('otherMethod(): void');
    expect(result.data.callHierarchy).toBeUndefined();
  });

  it('should include call hierarchy when requested', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(''); // Not needed for this test

    // Mocks for hover, signature, etc. can be minimal as they are not the focus of this test.
    mockClient.sendRequest
      .mockResolvedValueOnce({ contents: 'hover' }) // hover
      .mockResolvedValueOnce(null) // signatureHelp
      .mockResolvedValueOnce([]) // references
      .mockResolvedValueOnce([]); // documentSymbol

    // Mocks for call hierarchy
    const callHierarchyItem = {
      name: 'myMethod',
      kind: SymbolKind.Method,
      uri: 'file:///test.ts',
      range: { start: { line: 10, character: 2 }, end: { line: 15, character: 3 } },
      selectionRange: { start: { line: 10, character: 11 }, end: { line: 10, character: 19 } },
    };

    const incomingCall = {
      from: {
        name: 'callerFunc',
        kind: SymbolKind.Function,
        uri: 'file:///caller.ts',
        range: { start: { line: 5, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 5, character: 9 }, end: { line: 5, character: 19 } },
      },
      fromRanges: [{ start: { line: 7, character: 2 }, end: { line: 7, character: 10 } }],
    };

    // This is the 5th promise in the allSettled array
    // textDocument/prepareCallHierarchy
    mockClient.sendRequest.mockResolvedValueOnce([callHierarchyItem]);
    // callHierarchy/incomingCalls
    mockClient.sendRequest.mockResolvedValueOnce([incomingCall]);
    // callHierarchy/outgoingCalls
    mockClient.sendRequest.mockResolvedValueOnce([]);
    // recursive call for incoming calls of callerFunc
    mockClient.sendRequest.mockResolvedValueOnce([]);


    const result = await tool.execute({
      uri: 'file:///test.ts',
      position: { line: 10, character: 15 },
      includeCallHierarchy: true,
    });

    expect(result.data.callHierarchy).toBeDefined();
    expect(result.data.callHierarchy?.incoming).toHaveLength(1);
    expect(result.data.callHierarchy?.incoming[0]?.name).toBe('callerFunc');
    expect(result.data.callHierarchy?.outgoing).toHaveLength(0);
  });
});
