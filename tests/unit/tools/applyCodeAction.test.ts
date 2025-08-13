import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ApplyCodeActionTool } from '../../../src/tools/applyCodeAction.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { LSPClient } from '../../../src/lsp/client-v2.js';
import { MCPError } from '../../../src/tools/common-types.js';
import type { MessageConnection } from 'vscode-languageserver-protocol';
import { CodeActionKind } from 'vscode-languageserver-protocol';
import type {
  CodeAction,
  Command,
  Diagnostic,
  WorkspaceEdit,
  Location,
} from 'vscode-languageserver-protocol';

// Mock dependencies
jest.mock('../../../src/lsp/manager.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('ApplyCodeActionTool', () => {
  let tool: ApplyCodeActionTool;
  let mockPool: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;
  let mockConnection: jest.Mocked<MessageConnection>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock connection
    mockConnection = {
      sendRequest: jest.fn(),
    } as any;

    // Setup mock client with sendRequest method
    mockClient = {
      connection: mockConnection,
      sendRequest: mockConnection.sendRequest,
      capabilities: {
        codeActionProvider: true,
      },
      rootUri: 'file:///workspace',
    } as any;

    // Setup mock pool
    mockPool = {
      get: jest.fn().mockResolvedValue(mockClient),
      getForFile: jest.fn().mockResolvedValue(mockClient),
      getAllActive: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new ApplyCodeActionTool(mockPool);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Parameter validation', () => {
    it('should accept location with optional actionKind', async () => {
      const location: Location = {
        uri: 'file:///workspace/file.ts',
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      };

      const codeActions: CodeAction[] = [
        {
          title: 'Fix import',
          kind: CodeActionKind.QuickFix,
          edit: {
            changes: {
              'file:///workspace/file.ts': [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "import { foo } from './foo';\n",
                },
              ],
            },
          },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        location,
        actionKind: 'quickfix',
      });

      expect(result.data.actionTitle).toBeDefined();
    });

    it('should accept diagnostic reference', async () => {
      const diagnostic: Diagnostic = {
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
        message: 'Cannot find name "foo"',
        severity: 1,
      };

      const codeActions: CodeAction[] = [
        {
          title: 'Add import',
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          edit: {
            changes: {
              'file:///workspace/file.ts': [],
            },
          },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      await tool.execute({
        uri: 'file:///workspace/file.ts',
        diagnosticRef: diagnostic,
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith(
        'textDocument/codeAction',
        expect.objectContaining({
          context: {
            diagnostics: [diagnostic],
            only: undefined,
          },
        })
      );
    });

    it('should accept explicit uri and range', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Extract method',
          kind: CodeActionKind.RefactorExtract,
          edit: {
            changes: {},
          },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: {
          start: { line: 5, character: 0 },
          end: { line: 10, character: 0 },
        },
        actionKind: 'refactor.extract',
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith(
        'textDocument/codeAction',
        expect.objectContaining({
          textDocument: { uri: 'file:///workspace/file.ts' },
          range: {
            start: { line: 5, character: 0 },
            end: { line: 10, character: 0 },
          },
        })
      );
    });

    it('should reject when conflicting parameters are provided', async () => {
      await expect(
        tool.execute({
          location: {
            uri: 'file:///workspace/file.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
          uri: 'file:///workspace/file.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        } as any)
      ).rejects.toThrow(MCPError);
    });
  });

  describe('Code action filtering', () => {
    it('should filter actions by kind when specified', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Quick fix',
          kind: CodeActionKind.QuickFix,
          edit: { changes: {} },
        },
        {
          title: 'Extract method',
          kind: CodeActionKind.RefactorExtract,
          edit: { changes: {} },
        },
        {
          title: 'Organize imports',
          kind: CodeActionKind.SourceOrganizeImports,
          edit: { changes: {} },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        actionKind: 'refactor',
      });

      expect(result.data.actionTitle).toBeDefined();
      expect(result.data.actionTitle).toBe('Extract method');
    });

    it('should prefer exact kind matches over prefix matches', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Refactor',
          kind: 'refactor' as CodeActionKind,
          edit: { changes: {} },
        },
        {
          title: 'Extract method',
          kind: 'refactor.extract' as CodeActionKind,
          edit: { changes: {} },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        actionKind: 'refactor.extract',
      });

      expect(result.data.actionTitle).toBe('Extract method');
    });

    it('should apply the first matching action by default', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Fix 1',
          kind: CodeActionKind.QuickFix,
          edit: { changes: {} },
        },
        {
          title: 'Fix 2',
          kind: CodeActionKind.QuickFix,
          edit: { changes: {} },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        actionKind: 'quickfix',
      });

      expect(result.data.actionTitle).toBe('Fix 1');
    });
  });

  describe('Action execution', () => {
    it('should apply workspace edit from code action', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///workspace/file.ts': [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "import { foo } from './foo';\n",
            },
          ],
        },
      };

      const codeActions: CodeAction[] = [
        {
          title: 'Add import',
          kind: CodeActionKind.QuickFix,
          edit,
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 10, character: 0 }, end: { line: 10, character: 10 } },
      });

      expect(result.data.filesModified).toBe(1);
      expect(result.data.actionTitle).toBeDefined();
      expect(result.data.diff).toBeDefined();
    });

    it('should execute command when code action contains command', async () => {
      const command: Command = {
        title: 'Rename',
        command: 'editor.action.rename',
        arguments: ['file:///workspace/file.ts', { line: 10, character: 5 }],
      };

      const codeActions: CodeAction[] = [
        {
          title: 'Rename symbol',
          kind: CodeActionKind.Refactor,
          command,
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce(codeActions) // For codeAction request
        .mockResolvedValueOnce(undefined); // For executeCommand request

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
      });

      expect(mockConnection.sendRequest).toHaveBeenCalledWith('workspace/executeCommand', {
        command: 'editor.action.rename',
        arguments: command.arguments,
      });
      expect(result.data.executedCommand).toBeDefined();
    });

    it('should handle both edit and command in single action', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Fix and format',
          kind: CodeActionKind.QuickFix,
          edit: {
            changes: {
              'file:///workspace/file.ts': [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: 'const x = 1;\n',
                },
              ],
            },
          },
          command: {
            title: 'Format',
            command: 'editor.action.formatDocument',
            arguments: [],
          },
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce(codeActions)
        .mockResolvedValueOnce(undefined);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      });

      expect(result.data.summary.filesChanged).toBe(1);
      expect(result.data.executedCommand).toBeDefined();
    });

    it('should handle empty code actions list', async () => {
      mockConnection.sendRequest.mockResolvedValue([]);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      });

      expect(result.data.summary).toContain('No code actions available');
    });
  });

  describe('Error handling', () => {
    it('should handle language server without code action support', async () => {
      mockClient.capabilities = {};

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        })
      ).rejects.toThrow('does not support code actions');
    });

    it('should handle language server errors gracefully', async () => {
      mockConnection.sendRequest.mockRejectedValue(new Error('Language server crashed'));

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        })
      ).rejects.toThrow('Failed to get or apply code actions');
    });

    it('should handle command execution failures', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Action with command',
          kind: CodeActionKind.Refactor,
          command: {
            title: 'Custom command',
            command: 'custom.command',
            arguments: [],
          },
        },
      ];

      mockConnection.sendRequest
        .mockResolvedValueOnce(codeActions)
        .mockRejectedValueOnce(new Error('Command not found'));

      await expect(
        tool.execute({
          uri: 'file:///workspace/file.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        })
      ).rejects.toThrow('Failed to execute command');
    });
  });

  describe('Available actions listing', () => {
    it('should include available actions in result when no matching kind', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Quick fix',
          kind: CodeActionKind.QuickFix,
        },
        {
          title: 'Extract method',
          kind: CodeActionKind.RefactorExtract,
        },
        {
          title: 'Organize imports',
          kind: CodeActionKind.SourceOrganizeImports,
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        actionKind: 'nonexistent',
      });

      expect(result.data.availableActions).toHaveLength(3);
      expect(result.data.availableActions).toEqual([
        { title: 'Quick fix', kind: CodeActionKind.QuickFix },
        { title: 'Extract method', kind: CodeActionKind.RefactorExtract },
        { title: 'Organize imports', kind: CodeActionKind.SourceOrganizeImports },
      ]);
    });

    it('should not include unavailable actions when applying by default', async () => {
      const codeActions: CodeAction[] = [
        {
          title: 'Fix import',
          kind: CodeActionKind.QuickFix,
          edit: { changes: {} },
        },
      ];

      mockConnection.sendRequest.mockResolvedValue(codeActions);

      const result = await tool.execute({
        uri: 'file:///workspace/file.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      });

      expect(result.data.availableActions).toBeUndefined();
      expect(result.data.availableActions).toHaveLength(1);
    });
  });
});
