/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { jest } from '@jest/globals';

// Create mock before importing
const mockReadFile = jest.fn<typeof import('fs/promises').readFile>();

// Mock fs/promises module
jest.unstable_mockModule('fs/promises', () => ({
  readFile: mockReadFile,
}));

jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/tools/transactions.js');
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import type { readFile } from 'fs/promises';
// Types are only used for mocking, not directly imported
// import { LSPClientV2 } from '../../../src/lsp/client-v2.js';
// import { EditTransactionManager } from '../../../src/tools/transactions.js';
import {
  CodeAction,
  Command,
  WorkspaceEdit,
  TextEdit,
  Diagnostic,
} from 'vscode-languageserver-protocol';

describe('ApplyEditTool', () => {
  let tool: ApplyEditTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: any;
  let mockTransactionManager: any;

  beforeEach(() => {
    mockClient = {
      sendRequest: jest.fn(),
      sendNotification: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      getCapabilities: jest.fn(),
    };

    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    mockTransactionManager = {
      executeTransaction: jest.fn(),
    };

    tool = new ApplyEditTool(mockClientManager, mockReadFile as typeof readFile);
    // Replace the transaction manager with our mock
    const toolWithMock = tool as any;
    toolWithMock.transactionManager = mockTransactionManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('applyEdit');
      expect(tool.description).toBe(
        'Apply code modifications via LSP with automatic rollback on failure.\n' +
          'Supports code actions, symbol renaming, formatting, text editing, search/replace,\n' +
          'file operations, and smart insertions. All operations are transactional - if any\n' +
          'part fails, all changes are rolled back to maintain consistency.'
      );
    });
  });

  describe('code actions', () => {
    it('should execute code actions with workspace edit', async () => {
      const codeAction: CodeAction = {
        title: 'Fix import',
        edit: {
          documentChanges: [
            {
              textDocument: { uri: 'file:///test/file.ts', version: null },
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: 'import { foo } from "./foo";\n',
                },
              ],
            },
          ],
        },
      };

      mockClient.sendRequest.mockResolvedValue([codeAction]);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'codeAction',
        actions: [
          {
            uri: 'file:///test/file.ts',
            position: { line: 0, character: 0 },
          },
        ],
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        'textDocument/codeAction',
        expect.any(Object)
      );
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith([codeAction.edit], {
        atomic: true,
        dryRun: false,
      });
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
    });

    it('should execute code actions with command', async () => {
      const command: Command = {
        title: 'Organize Imports',
        command: 'typescript.organizeImports',
        arguments: ['file:///test/file.ts'],
      };

      const resultEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test/file.ts', version: null },
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
                newText: 'organized imports',
              },
            ],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce([command])
        .mockResolvedValueOnce({ edit: resultEdit });

      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'codeAction',
        actions: [
          {
            uri: 'file:///test/file.ts',
            actionKind: 'source',
          },
        ],
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith('workspace/executeCommand', {
        command: 'typescript.organizeImports',
        arguments: ['file:///test/file.ts'],
      });
      expect(result.success).toBe(true);
    });

    it('should select preferred action kind when strategy is "preferred"', async () => {
      const actions: CodeAction[] = [
        {
          title: 'Extract Method',
          kind: 'refactor.extract.method',
          edit: { documentChanges: [] },
        },
        {
          title: 'Quick Fix',
          kind: 'quickfix',
          edit: { documentChanges: [] },
        },
        {
          title: 'Organize Imports',
          kind: 'source.organizeImports',
          edit: { documentChanges: [] },
        },
      ];

      mockClient.sendRequest.mockResolvedValue(actions);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [],
      });

      const result = await tool.execute({
        type: 'codeAction',
        actions: [
          {
            uri: 'file:///test/file.ts',
            position: { line: 0, character: 0 },
            selectionStrategy: 'preferred',
            preferredKinds: ['quickfix', 'refactor.extract'],
          },
        ],
      });

      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        [(actions[1] as CodeAction).edit!], // Should select the quickfix action
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it('should apply multiple actions when strategy is "all"', async () => {
      const actions: CodeAction[] = [
        {
          title: 'Fix 1',
          edit: { documentChanges: [] },
        },
        {
          title: 'Fix 2',
          edit: { documentChanges: [] },
        },
        {
          title: 'Fix 3',
          edit: { documentChanges: [] },
        },
      ];

      mockClient.sendRequest.mockResolvedValue(actions);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 3,
        totalChanges: 3,
        changes: [],
      });

      const result = await tool.execute({
        type: 'codeAction',
        actions: [
          {
            uri: 'file:///test/file.ts',
            position: { line: 0, character: 0 },
            selectionStrategy: 'all',
            maxActions: 2,
          },
        ],
      });

      // Should apply only first 2 actions due to maxActions
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        [(actions[0] as CodeAction).edit!, (actions[1] as CodeAction).edit!],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it('should match diagnostic when strategy is "best-match"', async () => {
      const diagnostic: Diagnostic = {
        range: { start: { line: 5, character: 10 }, end: { line: 5, character: 20 } },
        message: 'Variable is not used',
        severity: 2,
      };

      const actions: CodeAction[] = [
        {
          title: 'Generic Fix',
          edit: { documentChanges: [] },
        },
        {
          title: 'Remove unused variable',
          diagnostics: [diagnostic],
          edit: { documentChanges: [] },
        },
      ];

      mockClient.sendRequest.mockResolvedValue(actions);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [],
      });

      const result = await tool.execute({
        type: 'codeAction',
        actions: [
          {
            uri: 'file:///test/file.ts',
            diagnostic: {
              message: diagnostic.message,
              range: diagnostic.range,
              code: diagnostic.code?.toString(),
            },
            selectionStrategy: 'best-match',
          },
        ],
      });

      // Should select the action that matches the diagnostic
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        [(actions[1] as CodeAction).edit!],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe('rename', () => {
    it('should execute rename operation', async () => {
      const renameEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test/file1.ts', version: null },
            edits: [
              {
                range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
                newText: 'newName',
              },
              {
                range: { start: { line: 20, character: 10 }, end: { line: 20, character: 20 } },
                newText: 'newName',
              },
            ],
          },
          {
            textDocument: { uri: 'file:///test/file2.ts', version: null },
            edits: [
              {
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
                newText: 'newName',
              },
            ],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce({
          range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
        }) // prepareRename
        .mockResolvedValueOnce(renameEdit); // rename

      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 2,
        totalChanges: 3,
        changes: [
          { uri: 'file:///test/file1.ts', edits: 2 },
          { uri: 'file:///test/file2.ts', edits: 1 },
        ],
      });

      const result = await tool.execute({
        type: 'rename',
        rename: {
          uri: 'file:///test/file1.ts',
          position: { line: 10, character: 10 },
          newName: 'newName',
        },
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        'textDocument/prepareRename',
        expect.any(Object)
      );
      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/rename', {
        textDocument: { uri: 'file:///test/file1.ts' },
        position: { line: 10, character: 10 },
        newName: 'newName',
      });
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
    });

    it('should handle rename not allowed', async () => {
      mockClient.sendRequest
        .mockResolvedValueOnce(null) // prepareRename returns null
        .mockResolvedValueOnce(null); // rename also returns null

      const result = await tool.execute({
        type: 'rename',
        rename: {
          uri: 'file:///test/file.ts',
          position: { line: 10, character: 10 },
          newName: 'newName',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Rename failed - no edits returned');
    });
  });

  describe('format', () => {
    it('should format single file', async () => {
      const textEdits: TextEdit[] = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
          newText: 'formatted code',
        },
      ];

      mockClient.sendRequest.mockResolvedValue(textEdits);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'format',
        format: {
          uris: 'file:///test/file.ts',
          options: {
            tabSize: 4,
            insertSpaces: true,
          },
        },
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/formatting', {
        textDocument: { uri: 'file:///test/file.ts' },
        options: {
          tabSize: 4,
          insertSpaces: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it('should format multiple files', async () => {
      const textEdits: TextEdit[] = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
          newText: 'formatted',
        },
      ];

      mockClient.sendRequest.mockResolvedValue(textEdits);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 2,
        totalChanges: 2,
        changes: [
          { uri: 'file:///test/file1.ts', edits: 1 },
          { uri: 'file:///test/file2.ts', edits: 1 },
        ],
      });

      const result = await tool.execute({
        type: 'format',
        format: {
          uris: ['file:///test/file1.ts', 'file:///test/file2.ts'],
        },
      });

      expect(mockClient.sendRequest).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
    });
  });

  describe('dry run mode', () => {
    it('should preview changes without applying', async () => {
      const renameEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test/file.ts', version: null },
            edits: [
              {
                range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
                newText: 'newName',
              },
            ],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce({
          range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
        })
        .mockResolvedValueOnce(renameEdit);

      const result = await tool.execute({
        type: 'rename',
        rename: {
          uri: 'file:///test/file.ts',
          position: { line: 10, character: 10 },
          newName: 'newName',
        },
        dryRun: true,
      });

      expect(mockTransactionManager.executeTransaction).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
      expect(result.totalChanges).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle missing language server', async () => {
      mockClientManager.get = jest.fn((_language: string, _workspace: string) =>
        Promise.resolve(null as any)
      );

      const result = await tool.execute({
        type: 'format',
        format: {
          uris: 'file:///test/file.ts',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('No language server available');
    });

    it('should handle transaction errors', async () => {
      const codeAction: CodeAction = {
        title: 'Fix',
        edit: {
          documentChanges: [],
        },
      };

      mockClient.sendRequest.mockResolvedValue([codeAction]);
      mockTransactionManager.executeTransaction.mockRejectedValue(new Error('Transaction failed'));

      const result = await tool.execute({
        type: 'codeAction',
        actions: [{ uri: 'file:///test/file.ts' }],
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Transaction failed');
    });
  });

  describe('organize imports', () => {
    it('should organize imports using code actions', async () => {
      const codeAction: CodeAction = {
        title: 'Organize Imports',
        kind: 'source.organizeImports',
        edit: {
          documentChanges: [
            {
              textDocument: { uri: 'file:///test/file.ts', version: null },
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
                  newText: 'organized imports',
                },
              ],
            },
          ],
        },
      };

      mockClient.sendRequest.mockResolvedValue([codeAction]);
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'organizeImports',
        format: {
          uris: ['file:///test/file.ts'],
        },
      });

      expect(mockClient.sendRequest).toHaveBeenCalledWith(
        'textDocument/codeAction',
        expect.objectContaining({
          context: expect.objectContaining({
            only: ['source'],
          }),
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('textEdit', () => {
    it('should execute direct text edits', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 2,
        changes: [{ uri: 'file:///test/file.ts', edits: 2 }],
      });

      const result = await tool.execute({
        type: 'textEdit',
        textEdit: {
          uri: 'file:///test/file.ts',
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              newText: 'replacement',
            },
            {
              range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
              newText: 'insertion\n',
            },
          ],
        },
      });

      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        [
          {
            documentChanges: [
              {
                textDocument: { uri: 'file:///test/file.ts', version: null },
                edits: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                    newText: 'replacement',
                  },
                  {
                    range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
                    newText: 'insertion\n',
                  },
                ],
              },
            ],
          },
        ],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
    });
  });

  describe('multiFileEdit', () => {
    it('should execute edits across multiple files', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 2,
        totalChanges: 3,
        changes: [
          { uri: 'file:///test/file1.ts', edits: 2 },
          { uri: 'file:///test/file2.ts', edits: 1 },
        ],
      });

      const result = await tool.execute({
        type: 'multiFileEdit',
        multiFileEdit: {
          edits: [
            {
              uri: 'file:///test/file1.ts',
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                  newText: 'hello',
                },
                {
                  range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
                  newText: 'world',
                },
              ],
            },
            {
              uri: 'file:///test/file2.ts',
              edits: [
                {
                  range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
                  newText: 'new line\n',
                },
              ],
            },
          ],
        },
      });

      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
      expect(result.totalChanges).toBe(3);
    });
  });

  describe('batch operations', () => {
    it('should execute multiple operations in sequence', async () => {
      const renameEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test/file.ts', version: null },
            edits: [
              {
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } },
                newText: 'newName',
              },
            ],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce([
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: '',
          },
        ]) // format
        .mockResolvedValueOnce({
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } },
        }) // prepareRename
        .mockResolvedValueOnce(renameEdit); // rename

      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 3,
        changes: [{ uri: 'file:///test/file.ts', edits: 3 }],
      });

      const result = await tool.execute({
        type: 'batch',
        batchOperations: {
          operations: [
            {
              type: 'format',
              format: {
                uris: 'file:///test/file.ts',
              },
            },
            {
              type: 'rename',
              rename: {
                uri: 'file:///test/file.ts',
                position: { line: 5, character: 2 },
                newName: 'newName',
              },
            },
            {
              type: 'textEdit',
              textEdit: {
                uri: 'file:///test/file.ts',
                edits: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    newText: '// Comment\n',
                  },
                ],
              },
            },
          ],
        },
      });

      expect(result.success).toBe(true);
      expect(result.totalChanges).toBe(3);
    });
  });

  describe('searchReplace', () => {
    it('should execute search and replace with regex', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 3,
        totalChanges: 5,
        changes: [
          { uri: 'file:///test/file1.ts', edits: 2 },
          { uri: 'file:///test/file2.ts', edits: 2 },
          { uri: 'file:///test/file3.ts', edits: 1 },
        ],
      });

      const result = await tool.execute({
        type: 'searchReplace',
        searchReplace: {
          pattern: '/oldPattern(\\w+)/g',
          replacement: 'newPattern$1',
          filePattern: '**/*.ts',
          excludePatterns: ['node_modules/**'],
          scope: 'workspace',
        },
      });

      expect(mockTransactionManager.executeTransaction).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(3);
      expect(result.totalChanges).toBe(5);
    });

    it('should execute search and replace with literal string', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 3,
        changes: [{ uri: 'file:///test/file.ts', edits: 3 }],
      });

      const result = await tool.execute({
        type: 'searchReplace',
        searchReplace: {
          pattern: 'oldName',
          replacement: 'newName',
          filePattern: 'src/**/*.ts',
          scope: 'directory',
          uri: 'file:///test/src',
        },
      });

      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
    });
  });

  describe('fileOperation', () => {
    it('should create files with content', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 2,
        totalChanges: 2,
        changes: [
          { uri: 'file:///test/new-file1.ts', edits: 1 },
          { uri: 'file:///test/new-file2.ts', edits: 1 },
        ],
      });

      const result = await tool.execute({
        type: 'fileOperation',
        fileOperation: {
          operations: [
            {
              type: 'create',
              uri: 'file:///test/new-file1.ts',
              content: 'export const foo = "bar";',
              overwrite: false,
            },
            {
              type: 'create',
              uri: 'file:///test/new-file2.ts',
              content: 'export const baz = "qux";',
              overwrite: true,
            },
          ],
        },
      });

      expect(mockTransactionManager.executeTransaction).toHaveBeenCalled();
      const calls = mockTransactionManager.executeTransaction.mock.calls;
      const workspaceEdits = calls[0][0];
      expect(workspaceEdits).toHaveLength(1);
      expect(workspaceEdits[0].documentChanges).toHaveLength(4); // 2 create + 2 text edits
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
    });

    it('should delete files', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 2,
        totalChanges: 2,
        changes: [],
      });

      const result = await tool.execute({
        type: 'fileOperation',
        fileOperation: {
          operations: [
            {
              type: 'delete',
              uri: 'file:///test/old-file1.ts',
              recursive: false,
              ignoreIfNotExists: true,
            },
            {
              type: 'delete',
              uri: 'file:///test/old-dir',
              recursive: true,
              ignoreIfNotExists: false,
            },
          ],
        },
      });

      const calls = mockTransactionManager.executeTransaction.mock.calls;
      const workspaceEdits = calls[0][0];
      expect(workspaceEdits).toHaveLength(1);
      expect(workspaceEdits[0].documentChanges).toHaveLength(2);
      expect(result.success).toBe(true);
    });

    it('should rename files', async () => {
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [],
      });

      const result = await tool.execute({
        type: 'fileOperation',
        fileOperation: {
          operations: [
            {
              type: 'rename',
              oldUri: 'file:///test/old-name.ts',
              newUri: 'file:///test/new-name.ts',
              overwrite: false,
            },
          ],
        },
      });

      const calls = mockTransactionManager.executeTransaction.mock.calls;
      const workspaceEdits = calls[0][0];
      expect(workspaceEdits[0].documentChanges).toHaveLength(1);
      expect(workspaceEdits[0].documentChanges[0]).toHaveProperty('kind', 'rename');
      expect(result.success).toBe(true);
    });
  });

  describe('smartInsert', () => {
    beforeEach(() => {
      // Reset fs mock
      mockReadFile.mockClear();
    });

    it('should insert imports at the correct location', async () => {
      mockReadFile.mockResolvedValue(
        'import { useState } from "react";\n' +
          'import { useEffect } from "react";\n' +
          '\n' +
          'const MyComponent = () => {\n' +
          '  return <div>Hello</div>;\n' +
          '};'
      );
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'smartInsert',
        smartInsert: {
          uri: 'file:///test/file.ts',
          insertions: [
            {
              type: 'import',
              content: "import { Component } from '@angular/core';",
              preferredLocation: 'afterImports',
              sortOrder: 'alphabetical',
            },
          ],
        },
      });

      expect(mockTransactionManager.executeTransaction).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
    });

    it('should insert methods into classes', async () => {
      mockReadFile.mockResolvedValue('export class MyClass {\n' + '  constructor() {}\n' + '}');
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 2,
        changes: [{ uri: 'file:///test/class.ts', edits: 2 }],
      });

      const result = await tool.execute({
        type: 'smartInsert',
        smartInsert: {
          uri: 'file:///test/class.ts',
          insertions: [
            {
              type: 'method',
              content: 'public getName(): string { return this.name; }',
              className: 'MyClass',
              preferredLocation: 'insideClass',
            },
            {
              type: 'property',
              content: 'private name: string;',
              className: 'MyClass',
              preferredLocation: 'insideClass',
            },
          ],
        },
      });

      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
      expect(result.totalChanges).toBe(2);
    });

    it('should add comments at specific locations', async () => {
      mockReadFile.mockResolvedValue(
        'function doSomething() {\n' + '  console.log("doing something");\n' + '}'
      );
      mockTransactionManager.executeTransaction.mockResolvedValue({
        success: true,
        transactionId: 'test-id',
        filesModified: 1,
        totalChanges: 1,
        changes: [{ uri: 'file:///test/file.ts', edits: 1 }],
      });

      const result = await tool.execute({
        type: 'smartInsert',
        smartInsert: {
          uri: 'file:///test/file.ts',
          insertions: [
            {
              type: 'comment',
              content: '// TODO: Implement error handling',
              preferredLocation: 'top',
            },
          ],
        },
      });

      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(1);
    });
  });
});
