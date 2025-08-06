import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DiagnosticsTool } from '../../../src/tools/diagnostics.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { Diagnostic, DiagnosticSeverity, CodeAction } from 'vscode-languageserver-protocol';

describe('DiagnosticsTool', () => {
  let tool: DiagnosticsTool;
  let mockConnectionPool: jest.Mocked<ConnectionPool>;
  let mockConnection: {
    sendRequest: jest.Mock;
    getDiagnostics: jest.Mock;
    getAllDiagnostics: jest.Mock;
  };

  beforeEach(() => {
    // Create mock connection
    mockConnection = {
      sendRequest: jest.fn(),
      getDiagnostics: jest.fn(),
      getAllDiagnostics: jest.fn(),
    };

    // Create mock connection pool
    mockConnectionPool = {
      getForFile: jest.fn().mockResolvedValue(mockConnection),
      getAllConnections: jest.fn().mockReturnValue([mockConnection]),
      get: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getConnectionInfo: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new DiagnosticsTool(mockConnectionPool);
  });

  describe('execute', () => {
    const mockDiagnostic: Diagnostic = {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 },
      },
      message: "Cannot find name 'userr'. Did you mean 'user'?",
      severity: DiagnosticSeverity.Error,
      code: 2552,
      source: 'typescript',
    };

    const mockCodeAction: CodeAction = {
      title: "Change spelling to 'user'",
      kind: 'quickfix',
      edit: {
        changes: {
          'file:///test.ts': [
            {
              range: mockDiagnostic.range,
              newText: 'user',
            },
          ],
        },
      },
    };

    describe('file-specific diagnostics', () => {
      it('should get diagnostics for a specific file', async () => {
        const uri = 'file:///test.ts';
        mockConnection.getDiagnostics.mockReturnValue([mockDiagnostic]);
        mockConnection.sendRequest.mockResolvedValue([mockCodeAction]);

        const result = await tool.execute({ uri });

        expect(mockConnectionPool.getForFile).toHaveBeenCalledWith(uri, expect.any(String));
        expect(mockConnection.getDiagnostics).toHaveBeenCalledWith(uri);
        expect(result.summary.total).toBe(1);
        expect(result.summary.errors).toBe(1);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics![0]).toMatchObject({
          uri,
          severity: 'error',
          message: mockDiagnostic.message,
          code: mockDiagnostic.code,
        });
      });

      it('should include quick fixes when available', async () => {
        const uri = 'file:///test.ts';
        mockConnection.getDiagnostics.mockReturnValue([mockDiagnostic]);
        mockConnection.sendRequest.mockResolvedValue([mockCodeAction]);

        const result = await tool.execute({ uri });

        const firstDiagnostic = result.diagnostics?.[0];
        expect(firstDiagnostic?.quickFixes).toHaveLength(1);
        const firstQuickFix = firstDiagnostic?.quickFixes?.[0];
        expect(firstQuickFix).toMatchObject({
          title: mockCodeAction.title,
          action: {
            type: 'codeAction',
            edit: mockCodeAction.edit,
          },
        });
      });

      it('should filter by severity', async () => {
        const uri = 'file:///test.ts';
        const warningDiagnostic: Diagnostic = {
          ...mockDiagnostic,
          severity: DiagnosticSeverity.Warning,
          message: 'Unused variable',
        };

        mockConnection.getDiagnostics.mockReturnValue([mockDiagnostic, warningDiagnostic]);

        const result = await tool.execute({ uri, severity: 'error' });

        expect(result.summary.total).toBe(1);
        expect(result.summary.errors).toBe(1);
        expect(result.summary.warnings).toBe(0);
        expect(result.diagnostics?.[0]?.message).toBe(mockDiagnostic.message);
      });

      it('should respect maxResults limit', async () => {
        const uri = 'file:///test.ts';
        const diagnostics = Array.from({ length: 10 }, (_, i) => ({
          ...mockDiagnostic,
          message: `Error ${i}`,
        }));

        mockConnection.getDiagnostics.mockReturnValue(diagnostics);

        const result = await tool.execute({ uri, maxResults: 5 });

        expect(result.summary.total).toBe(5);
        expect(result.diagnostics).toHaveLength(5);
      });

      it('should include related information when requested', async () => {
        const uri = 'file:///test.ts';
        const diagnosticWithRelated: Diagnostic = {
          ...mockDiagnostic,
          relatedInformation: [
            {
              location: {
                uri: 'file:///types.ts',
                range: {
                  start: { line: 5, character: 0 },
                  end: { line: 5, character: 10 },
                },
              },
              message: "Type 'User' is declared here",
            },
          ],
        };

        mockConnection.getDiagnostics.mockReturnValue([diagnosticWithRelated]);

        const result = await tool.execute({ uri, includeRelated: true });

        const firstDiagnostic = result.diagnostics?.[0];
        expect(firstDiagnostic?.related).toHaveLength(1);
        expect(firstDiagnostic?.related?.[0]).toMatchObject({
          location: {
            uri: 'file:///types.ts',
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 10 },
            },
          },
          message: "Type 'User' is declared here",
        });
      });
    });

    describe('workspace-wide diagnostics', () => {
      it('should get diagnostics for entire workspace', async () => {
        const diagnosticsMap = new Map([
          ['file:///a.ts', [mockDiagnostic]],
          [
            'file:///b.ts',
            [
              {
                ...mockDiagnostic,
                severity: DiagnosticSeverity.Warning,
                message: 'Warning in file B',
              },
            ],
          ],
        ]);

        mockConnection.getAllDiagnostics.mockReturnValue(diagnosticsMap);

        const result = await tool.execute({});

        expect(mockConnectionPool.getAllConnections).toHaveBeenCalled();
        expect(result.summary.total).toBe(2);
        expect(result.summary.errors).toBe(1);
        expect(result.summary.warnings).toBe(1);
        expect(result.summary.filesAffected).toBe(2);
        expect(result.byFile).toHaveLength(2);
      });

      it('should group diagnostics by file', async () => {
        const file1Diagnostics = [mockDiagnostic, { ...mockDiagnostic, message: 'Error 2' }];
        const file2Diagnostics = [
          {
            ...mockDiagnostic,
            severity: DiagnosticSeverity.Warning,
            message: 'Warning',
          },
        ];

        const diagnosticsMap = new Map([
          ['file:///a.ts', file1Diagnostics],
          ['file:///b.ts', file2Diagnostics],
        ]);

        mockConnection.getAllDiagnostics.mockReturnValue(diagnosticsMap);

        const result = await tool.execute({});

        expect(result.byFile).toHaveLength(2);
        expect(result.byFile?.[0]).toMatchObject({
          uri: 'file:///a.ts',
          count: 2,
          errorCount: 2,
          warningCount: 0,
        });
        expect(result.byFile?.[1]).toMatchObject({
          uri: 'file:///b.ts',
          count: 1,
          errorCount: 0,
          warningCount: 1,
        });
      });

      it('should sort files by error count', async () => {
        const diagnosticsMap = new Map([
          [
            'file:///few-errors.ts',
            [
              {
                ...mockDiagnostic,
                severity: DiagnosticSeverity.Warning,
              },
            ],
          ],
          [
            'file:///many-errors.ts',
            [
              mockDiagnostic,
              { ...mockDiagnostic, message: 'Error 2' },
              { ...mockDiagnostic, message: 'Error 3' },
            ],
          ],
        ]);

        mockConnection.getAllDiagnostics.mockReturnValue(diagnosticsMap);

        const result = await tool.execute({});

        expect(result.byFile?.[0]?.uri).toBe('file:///many-errors.ts');
        expect(result.byFile?.[0]?.errorCount).toBe(3);
        expect(result.byFile?.[1]?.uri).toBe('file:///few-errors.ts');
        expect(result.byFile?.[1]?.errorCount).toBe(0);
      });
    });

    describe('severity mapping', () => {
      it('should correctly map LSP severity to string', async () => {
        const uri = 'file:///test.ts';
        const diagnostics: Diagnostic[] = [
          { ...mockDiagnostic, severity: DiagnosticSeverity.Error },
          { ...mockDiagnostic, severity: DiagnosticSeverity.Warning },
          { ...mockDiagnostic, severity: DiagnosticSeverity.Information },
          { ...mockDiagnostic, severity: DiagnosticSeverity.Hint },
        ];

        mockConnection.getDiagnostics.mockReturnValue(diagnostics);

        const result = await tool.execute({ uri });

        expect(result.diagnostics?.[0]?.severity).toBe('error');
        expect(result.diagnostics?.[1]?.severity).toBe('warning');
        expect(result.diagnostics?.[2]?.severity).toBe('info');
        expect(result.diagnostics?.[3]?.severity).toBe('hint');
      });

      it('should handle missing severity as error', async () => {
        const uri = 'file:///test.ts';
        const diagnosticNoSeverity: Diagnostic = {
          range: mockDiagnostic.range,
          message: 'No severity specified',
        };

        mockConnection.getDiagnostics.mockReturnValue([diagnosticNoSeverity]);

        const result = await tool.execute({ uri });

        expect(result.diagnostics?.[0]?.severity).toBe('error');
      });
    });

    describe('error handling', () => {
      it('should handle missing getDiagnostics method gracefully', async () => {
        const uri = 'file:///test.ts';
        mockConnection.getDiagnostics = undefined;

        const result = await tool.execute({ uri });

        expect(result.summary.total).toBe(0);
        expect(result.diagnostics).toEqual([]);
      });

      it('should handle code action request failures gracefully', async () => {
        const uri = 'file:///test.ts';
        mockConnection.getDiagnostics.mockReturnValue([mockDiagnostic]);
        mockConnection.sendRequest.mockRejectedValue(new Error('Code action failed'));

        const result = await tool.execute({ uri });

        expect(result.diagnostics?.[0]?.quickFixes).toBeUndefined();
        expect(result.summary.total).toBe(1);
      });

      it('should handle null code actions response', async () => {
        const uri = 'file:///test.ts';
        mockConnection.getDiagnostics.mockReturnValue([mockDiagnostic]);
        mockConnection.sendRequest.mockResolvedValue(null);

        const result = await tool.execute({ uri });

        expect(result.diagnostics?.[0]?.quickFixes).toBeUndefined();
      });
    });

    describe('sorting', () => {
      it('should sort diagnostics by severity, file, and line', async () => {
        const diagnostics: Diagnostic[] = [
          {
            ...mockDiagnostic,
            severity: DiagnosticSeverity.Warning,
            range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
          },
          {
            ...mockDiagnostic,
            severity: DiagnosticSeverity.Error,
            range: { start: { line: 10, character: 0 }, end: { line: 10, character: 10 } },
          },
          {
            ...mockDiagnostic,
            severity: DiagnosticSeverity.Error,
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
          },
        ];

        const diagnosticsMap = new Map([
          ['file:///b.ts', [diagnostics[0]]],
          ['file:///a.ts', [diagnostics[1], diagnostics[2]]],
        ]);

        mockConnection.getAllDiagnostics.mockReturnValue(diagnosticsMap);

        const result = await tool.execute({});

        // Should be sorted: errors first, then by file, then by line
        expect(result.byFile?.[0]?.uri).toBe('file:///a.ts');
        expect(result.byFile?.[0]?.diagnostics[0]?.range.start.line).toBe(5);
        expect(result.byFile?.[0]?.diagnostics[1]?.range.start.line).toBe(10);
        expect(result.byFile?.[1]?.uri).toBe('file:///b.ts');
        expect(result.byFile?.[1]?.diagnostics[0]?.severity).toBe('warning');
      });
    });
  });
});
