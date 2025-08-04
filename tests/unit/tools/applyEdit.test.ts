import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { LSPClientV2 } from '../../../src/lsp/client-v2.js';
import { EditTransactionManager } from '../../../src/tools/transactions.js';
import {
  CodeAction,
  Command,
  WorkspaceEdit,
  TextEdit,
} from 'vscode-languageserver-protocol';

jest.mock('../../../src/lsp/index.js');
jest.mock('../../../src/tools/transactions.js');

describe('ApplyEditTool', () => {
  let tool: ApplyEditTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClientV2>;
  let mockTransactionManager: jest.Mocked<EditTransactionManager>;

  beforeEach(() => {
    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      getCapabilities: jest.fn(),
    } as any;

    mockClientManager = {
      get: jest.fn().mockResolvedValue(mockClient),
    } as any;

    mockTransactionManager = {
      executeTransaction: jest.fn(),
    } as any;

    tool = new ApplyEditTool(mockClientManager);
    // Replace the transaction manager with our mock
    (tool as any).transactionManager = mockTransactionManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('applyEdit');
      expect(tool.description).toBe('Apply code actions, renames, or formatting with rollback support');
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
              edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'import { foo } from "./foo";\n' }],
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

      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/codeAction', expect.any(Object));
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        [codeAction.edit],
        { atomic: true, dryRun: false }
      );
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
            edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } }, newText: 'organized imports' }],
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
  });

  describe('rename', () => {
    it('should execute rename operation', async () => {
      const renameEdit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///test/file1.ts', version: null },
            edits: [
              { range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } }, newText: 'newName' },
              { range: { start: { line: 20, character: 10 }, end: { line: 20, character: 20 } }, newText: 'newName' },
            ],
          },
          {
            textDocument: { uri: 'file:///test/file2.ts', version: null },
            edits: [
              { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } }, newText: 'newName' },
            ],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce({ range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } } }) // prepareRename
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

      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/prepareRename', expect.any(Object));
      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/rename', {
        textDocument: { uri: 'file:///test/file1.ts' },
        position: { line: 10, character: 10 },
        newName: 'newName',
      });
      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
    });

    it('should handle rename not allowed', async () => {
      mockClient.sendRequest.mockResolvedValueOnce(null); // prepareRename returns null

      const result = await tool.execute({
        type: 'rename',
        rename: {
          uri: 'file:///test/file.ts',
          position: { line: 10, character: 10 },
          newName: 'newName',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot rename at this location');
    });
  });

  describe('format', () => {
    it('should format single file', async () => {
      const textEdits: TextEdit[] = [
        { range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }, newText: 'formatted code' },
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
        { range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }, newText: 'formatted' },
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
            edits: [{ range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } }, newText: 'newName' }],
          },
        ],
      };

      mockClient.sendRequest
        .mockResolvedValueOnce({ range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } } })
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
      mockClientManager.get.mockResolvedValue(null);

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
              edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } }, newText: 'organized imports' }],
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

      expect(mockClient.sendRequest).toHaveBeenCalledWith('textDocument/codeAction', expect.objectContaining({
        context: expect.objectContaining({
          only: ['source'],
        }),
      }));
      expect(result.success).toBe(true);
    });
  });
});