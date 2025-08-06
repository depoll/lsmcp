import { BaseTool } from './base.js';
import { ConnectionPool } from '../lsp/manager.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';
import {
  Diagnostic,
  DiagnosticSeverity,
  CodeAction,
  CodeActionKind,
  Command,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol';

interface DiagnosticsInput {
  uri?: string;
  severity?: 'error' | 'warning' | 'info' | 'hint';
  includeRelated?: boolean;
  maxResults?: number;
}

interface DiagnosticWithFixes {
  uri: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  code?: string | number;
  source?: string;
  quickFixes?: Array<{
    title: string;
    action: {
      type: 'codeAction';
      edit?: WorkspaceEdit;
      command?: Command;
    };
  }>;
  related?: Array<{
    location: {
      uri: string;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };
    message: string;
  }>;
}

interface DiagnosticsOutput {
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    hints: number;
    filesAffected?: number;
  };
  diagnostics?: DiagnosticWithFixes[];
  byFile?: Array<{
    uri: string;
    count: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
    diagnostics: DiagnosticWithFixes[];
  }>;
}

export class DiagnosticsTool extends BaseTool<DiagnosticsInput, DiagnosticsOutput> {
  name = 'getDiagnostics';
  description = 'Get errors, warnings, and hints with severity filtering and quick fixes';

  inputSchema = z.object({
    uri: z
      .string()
      .optional()
      .describe('File URI for file-specific diagnostics. Omit for workspace-wide diagnostics'),
    severity: z
      .enum(['error', 'warning', 'info', 'hint'])
      .optional()
      .describe('Filter by severity level'),
    includeRelated: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include related diagnostic information'),
    maxResults: z
      .number()
      .optional()
      .default(500)
      .describe('Maximum number of diagnostics to return'),
  });

  private severityMap: Record<DiagnosticSeverity, 'error' | 'warning' | 'info' | 'hint'> = {
    [DiagnosticSeverity.Error]: 'error',
    [DiagnosticSeverity.Warning]: 'warning',
    [DiagnosticSeverity.Information]: 'info',
    [DiagnosticSeverity.Hint]: 'hint',
  };

  private reverseSeverityMap: Record<string, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };

  constructor(connectionPool: ConnectionPool) {
    super(connectionPool);
  }

  async execute(input: DiagnosticsInput): Promise<DiagnosticsOutput> {
    try {
      const { uri, severity, includeRelated = true, maxResults = 500 } = input;

      // Get diagnostics based on scope
      let allDiagnostics: Map<string, Diagnostic[]>;

      if (uri) {
        // File-specific diagnostics
        allDiagnostics = await this.getFileDiagnostics(uri);
      } else {
        // Workspace-wide diagnostics
        allDiagnostics = this.getWorkspaceDiagnostics();
      }

      // Convert to our format and filter
      const diagnosticsWithFixes = await this.processDiagnostics(
        allDiagnostics,
        severity,
        includeRelated,
        maxResults
      );

      // Generate summary and organize output
      return this.formatOutput(diagnosticsWithFixes, uri);
    } catch (error) {
      logger.error({ error, input }, 'Failed to get diagnostics');
      throw error;
    }
  }

  private async getFileDiagnostics(uri: string): Promise<Map<string, Diagnostic[]>> {
    const connection = await this.clientManager.getForFile(uri, process.cwd());
    const diagnostics = new Map<string, Diagnostic[]>();

    if (connection) {
      // Get cached diagnostics for the file
      const fileDiagnostics = connection.getDiagnostics(uri) || [];
      diagnostics.set(uri, fileDiagnostics);
    }

    return diagnostics;
  }

  private getWorkspaceDiagnostics(): Map<string, Diagnostic[]> {
    const connections = this.clientManager.getAllConnections();
    const allDiagnostics = new Map<string, Diagnostic[]>();

    for (const connection of connections) {
      // Get all cached diagnostics from this connection
      const diagnostics = connection.getAllDiagnostics() || new Map();

      // Merge with existing diagnostics
      for (const [uri, fileDiags] of diagnostics) {
        const existing = allDiagnostics.get(uri) || [];
        allDiagnostics.set(uri, [...existing, ...fileDiags]);
      }
    }

    return allDiagnostics;
  }

  private async processDiagnostics(
    diagnosticsMap: Map<string, Diagnostic[]>,
    severityFilter?: string,
    includeRelated: boolean = true,
    maxResults: number = 500
  ): Promise<DiagnosticWithFixes[]> {
    const processed: DiagnosticWithFixes[] = [];
    let count = 0;

    // Convert severity filter to LSP DiagnosticSeverity
    const targetSeverity = severityFilter ? this.reverseSeverityMap[severityFilter] : undefined;

    for (const [uri, diagnostics] of diagnosticsMap) {
      for (const diagnostic of diagnostics) {
        if (count >= maxResults) break;

        // Apply severity filter
        if (targetSeverity !== undefined && diagnostic.severity !== targetSeverity) {
          continue;
        }

        // Convert diagnostic to our format
        const severity = this.severityMap[diagnostic.severity || DiagnosticSeverity.Error];

        const diagnosticWithFix: DiagnosticWithFixes = {
          uri,
          severity,
          range: {
            start: {
              line: diagnostic.range.start.line,
              character: diagnostic.range.start.character,
            },
            end: {
              line: diagnostic.range.end.line,
              character: diagnostic.range.end.character,
            },
          },
          message: diagnostic.message,
          code: diagnostic.code,
          source: diagnostic.source,
        };

        // Get quick fixes for this diagnostic
        try {
          const quickFixes = await this.getQuickFixes(uri, diagnostic);
          if (quickFixes.length > 0) {
            diagnosticWithFix.quickFixes = quickFixes;
          }
        } catch (error) {
          logger.debug({ error, uri }, 'Failed to get quick fixes');
        }

        // Add related information if requested
        if (includeRelated && diagnostic.relatedInformation) {
          diagnosticWithFix.related = diagnostic.relatedInformation.map((related) => ({
            location: {
              uri: related.location.uri,
              range: {
                start: {
                  line: related.location.range.start.line,
                  character: related.location.range.start.character,
                },
                end: {
                  line: related.location.range.end.line,
                  character: related.location.range.end.character,
                },
              },
            },
            message: related.message,
          }));
        }

        processed.push(diagnosticWithFix);
        count++;
      }

      if (count >= maxResults) break;
    }

    // Sort by severity (errors first) then by file and line
    processed.sort((a, b) => {
      const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;

      const fileDiff = a.uri.localeCompare(b.uri);
      if (fileDiff !== 0) return fileDiff;

      return a.range.start.line - b.range.start.line;
    });

    return processed;
  }

  private async getQuickFixes(
    uri: string,
    diagnostic: Diagnostic
  ): Promise<
    Array<{
      title: string;
      action: {
        type: 'codeAction';
        edit?: WorkspaceEdit;
        command?: Command;
      };
    }>
  > {
    const connection = await this.clientManager.getForFile(uri, process.cwd());

    if (!connection) {
      return [];
    }

    try {
      // Request code actions for this diagnostic
      const codeActions = await connection.sendRequest<(CodeAction | Command)[] | null>(
        'textDocument/codeAction',
        {
          textDocument: { uri },
          range: diagnostic.range,
          context: {
            diagnostics: [diagnostic],
            only: [CodeActionKind.QuickFix],
          },
        }
      );

      if (!codeActions) return [];

      return codeActions
        .filter((action) => 'title' in action)
        .slice(0, 5) // Limit to 5 quick fixes per diagnostic
        .map((action) => {
          if ('edit' in action || 'command' in action) {
            // It's a CodeAction
            const codeAction = action as CodeAction;
            return {
              title: codeAction.title,
              action: {
                type: 'codeAction' as const,
                edit: codeAction.edit,
                command: codeAction.command,
              },
            };
          } else {
            // It's a Command
            return {
              title: action.title,
              action: {
                type: 'codeAction' as const,
                command: action as unknown as Command,
              },
            };
          }
        });
    } catch (error) {
      logger.debug({ error, uri }, 'Failed to get code actions');
      return [];
    }
  }

  private formatOutput(
    diagnostics: DiagnosticWithFixes[],
    requestedUri?: string
  ): DiagnosticsOutput {
    // Calculate summary
    const summary = {
      total: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      info: diagnostics.filter((d) => d.severity === 'info').length,
      hints: diagnostics.filter((d) => d.severity === 'hint').length,
      filesAffected: new Set(diagnostics.map((d) => d.uri)).size,
    };

    // If single file requested, return flat list
    if (requestedUri) {
      return {
        summary,
        diagnostics,
      };
    }

    // For workspace diagnostics, group by file
    const byFile = new Map<string, DiagnosticWithFixes[]>();
    for (const diagnostic of diagnostics) {
      const fileDiags = byFile.get(diagnostic.uri) || [];
      fileDiags.push(diagnostic);
      byFile.set(diagnostic.uri, fileDiags);
    }

    const fileGroups = Array.from(byFile.entries()).map(([uri, fileDiagnostics]) => ({
      uri,
      count: fileDiagnostics.length,
      errorCount: fileDiagnostics.filter((d) => d.severity === 'error').length,
      warningCount: fileDiagnostics.filter((d) => d.severity === 'warning').length,
      infoCount: fileDiagnostics.filter((d) => d.severity === 'info').length,
      hintCount: fileDiagnostics.filter((d) => d.severity === 'hint').length,
      diagnostics: fileDiagnostics,
    }));

    // Sort file groups by error count (most errors first)
    fileGroups.sort((a, b) => b.errorCount - a.errorCount || b.count - a.count);

    return {
      summary,
      byFile: fileGroups,
    };
  }
}
