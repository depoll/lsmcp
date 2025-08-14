import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { getLanguageFromUri } from '../utils/languages.js';
import {
  MCPError,
  MCPErrorCode,
  StandardResult,
  rangeSchema,
  locationSchema,
} from './common-types.js';
import { formatWorkspaceEditAsDiff, formatWorkspaceEditSummary } from '../utils/diff-formatter.js';
import { applyWorkspaceEdit } from '../utils/file-operations.js';
import {
  CodeAction,
  CodeActionParams,
  CodeActionKind,
  Command,
  Diagnostic,
  Range,
} from 'vscode-languageserver-protocol';

// Schema for diagnostic reference
const DiagnosticRefSchema = z.object({
  uri: z.string().describe('File URI containing the diagnostic'),
  range: rangeSchema.describe('Range of the diagnostic'),
  message: z
    .string()
    .optional()
    .describe('Diagnostic message to help identify specific diagnostic'),
  severity: z
    .number()
    .optional()
    .describe('Diagnostic severity (1=Error, 2=Warning, 3=Info, 4=Hint)'),
});

// Schema for code action kinds
const CodeActionKindSchema = z
  .enum([
    'quickfix',
    'refactor',
    'refactor.extract',
    'refactor.extract.function',
    'refactor.extract.method',
    'refactor.extract.variable',
    'refactor.extract.constant',
    'refactor.inline',
    'refactor.inline.variable',
    'refactor.inline.function',
    'refactor.rewrite',
    'refactor.move',
    'source',
    'source.organizeImports',
    'source.fixAll',
  ])
  .describe('Type of code action to apply');

// Input schema for the apply code action tool
const ApplyCodeActionParamsSchema = z
  .object({
    // Option 1: Fix a specific diagnostic
    diagnosticRef: DiagnosticRefSchema.optional().describe(
      'Reference to a diagnostic from getDiagnostics tool'
    ),

    // Option 2: Apply refactoring at location
    location: locationSchema
      .optional()
      .describe('Location from other tools where to apply the code action'),

    // Option 3: Apply action at specific range
    uri: z.string().optional().describe('File URI where to apply the code action'),
    range: rangeSchema.optional().describe('Range where to apply the code action'),

    // Filtering and selection
    actionKind: CodeActionKindSchema.optional().describe('Filter by specific code action kind'),
    preferredTitle: z
      .string()
      .optional()
      .describe('Partial match on action title to select specific action'),
    autoApply: z
      .boolean()
      .optional()
      .describe('Automatically apply the first matching action (default: false)'),
    includeAll: z
      .boolean()
      .optional()
      .describe('Include all actions, not just preferred ones (default: false)'),
  })
  .refine((data) => data.diagnosticRef || data.location || (data.uri && data.range), {
    message: 'Either diagnosticRef, location, or both uri and range must be provided',
  });

export type ApplyCodeActionParams = z.infer<typeof ApplyCodeActionParamsSchema>;

/**
 * Result data for applying a code action
 */
interface ApplyCodeActionData {
  /**
   * Title of the applied action
   */
  actionTitle: string;

  /**
   * Kind of action applied
   */
  actionKind?: string;

  /**
   * Summary of changes made
   */
  summary?: string;

  /**
   * Detailed diff of all changes
   */
  diff?: string;

  /**
   * Number of files modified
   */
  filesModified?: number;

  /**
   * Command executed (if any)
   */
  executedCommand?: {
    command: string;
    arguments?: unknown[];
  };

  /**
   * Available actions (when autoApply is false)
   */
  availableActions?: Array<{
    title: string;
    kind?: string;
    isPreferred?: boolean;
  }>;
}

/**
 * Tool for applying code actions (quick fixes, refactorings) using LSP
 *
 * This tool provides access to language server code actions like quick fixes,
 * refactorings, and source actions without manual text editing.
 *
 * Action Selection Behavior:
 * - When includeAll is false (default), preferred actions are prioritized
 * - If no preferred actions exist, all matching actions are considered as fallback
 * - The first matching action is selected when autoApply is true
 * - When autoApply is false, all available actions are returned for manual selection
 */
export class ApplyCodeActionTool extends BatchableTool<
  ApplyCodeActionParams,
  StandardResult<ApplyCodeActionData>
> {
  readonly name = 'applyCodeAction';
  readonly description = `Apply code actions like quick fixes and refactorings using LSP.

Accepts diagnostic references from getDiagnostics or locations from other tools.
Supports filtering by action kind and automatic application.

Action Kinds:
- quickfix: Fix problems from diagnostics
- refactor.extract.*: Extract method/function/variable/constant
- refactor.inline.*: Inline variable/function
- refactor.move: Move symbol to new location
- source.organizeImports: Organize import statements
- source.fixAll: Fix all auto-fixable problems

Examples:
1. Fix a diagnostic:
   const diagnostics = await getDiagnostics();
   await applyCodeAction({ diagnosticRef: diagnostics[0], autoApply: true });

2. Extract function:
   const location = await findSymbols({ query: "complexLogic" });
   await applyCodeAction({ 
     location: location[0].location,
     actionKind: "refactor.extract.function",
     autoApply: true
   });

3. Organize imports:
   await applyCodeAction({
     uri: "file:///src/app.ts",
     range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
     actionKind: "source.organizeImports",
     autoApply: true
   });`;

  readonly inputSchema = ApplyCodeActionParamsSchema;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: ApplyCodeActionParams): Promise<StandardResult<ApplyCodeActionData>> {
    const startTime = Date.now();
    const validated = this.validateParams(params);
    // Apply defaults since they're optional in the input but required for logic
    const autoApply = validated.autoApply ?? false;
    const includeAll = validated.includeAll ?? false;

    // Extract uri and range from various input formats
    let uri: string;
    let range: Range;
    let diagnostics: Diagnostic[] = [];

    if (validated.diagnosticRef) {
      uri = validated.diagnosticRef.uri;
      range = validated.diagnosticRef.range;

      // Create a diagnostic object for context
      diagnostics = [
        {
          range: validated.diagnosticRef.range,
          message: validated.diagnosticRef.message || '',
          severity: (validated.diagnosticRef.severity as Diagnostic['severity']) || 1,
        },
      ];
    } else if (validated.location) {
      uri = validated.location.uri;
      range = validated.location.range;
    } else {
      uri = validated.uri!;
      range = validated.range!;
    }

    // Get the appropriate language server
    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, process.cwd());

    if (!client) {
      throw new MCPError(
        MCPErrorCode.InternalError,
        `No language server available for ${language || 'unknown language'}`
      );
    }

    try {
      // Request code actions
      const codeActionParams: CodeActionParams = {
        textDocument: { uri },
        range,
        context: {
          diagnostics,
          only: validated.actionKind ? [validated.actionKind as CodeActionKind] : undefined,
        },
      };

      const actions = await client.sendRequest<(CodeAction | Command)[] | null>(
        'textDocument/codeAction',
        codeActionParams
      );

      if (!actions || actions.length === 0) {
        return {
          data: {
            actionTitle: 'No actions available',
            availableActions: [],
          },
          metadata: {
            processingTime: Date.now() - startTime,
            cached: false,
          },
          fallback: 'No code actions available at this location',
        };
      }

      // Filter to only CodeActions (not Commands) for now
      const codeActions = actions.filter(
        (action): action is CodeAction =>
          'title' in action && ('edit' in action || 'command' in action)
      );

      // Filter by preferred title if specified
      let filteredActions = codeActions;
      if (validated.preferredTitle) {
        filteredActions = codeActions.filter((action) =>
          action.title.toLowerCase().includes(validated.preferredTitle!.toLowerCase())
        );
      }

      // Filter by preferred status unless includeAll is true
      // If no preferred actions exist, fall back to all filtered actions
      if (!includeAll) {
        const preferredActions = filteredActions.filter((action) => action.isPreferred);
        if (preferredActions.length > 0) {
          filteredActions = preferredActions;
        }
        // Note: If preferredActions.length === 0, we keep all filteredActions as fallback
      }

      // If not auto-applying, return available actions
      if (!autoApply) {
        const availableActions = filteredActions.map((action) => ({
          title: action.title,
          kind: action.kind,
          isPreferred: action.isPreferred,
        }));

        return {
          data: {
            actionTitle: 'Available actions',
            availableActions,
          },
          metadata: {
            processingTime: Date.now() - startTime,
            cached: false,
          },
        };
      }

      // Select the first matching action
      const selectedAction = filteredActions[0];
      if (!selectedAction) {
        throw new MCPError(MCPErrorCode.InvalidRequest, 'No matching code actions found');
      }

      // Apply the workspace edit if present
      let summary: string | undefined;
      let diff: string | undefined;
      let filesModified: number | undefined;

      if (selectedAction.edit) {
        await applyWorkspaceEdit(selectedAction.edit);
        summary = formatWorkspaceEditSummary(selectedAction.edit);
        diff = formatWorkspaceEditAsDiff(selectedAction.edit);

        // Count modified files
        if (selectedAction.edit.changes) {
          filesModified = Object.keys(selectedAction.edit.changes).length;
        } else if (selectedAction.edit.documentChanges) {
          const uniqueFiles = new Set<string>();
          for (const change of selectedAction.edit.documentChanges) {
            if ('textDocument' in change) {
              uniqueFiles.add(change.textDocument.uri);
            }
          }
          filesModified = uniqueFiles.size;
        }
      }

      // Execute the command if present
      let executedCommand: { command: string; arguments?: unknown[] } | undefined;
      if (selectedAction.command) {
        const command =
          typeof selectedAction.command === 'string'
            ? { command: selectedAction.command, arguments: [] }
            : selectedAction.command;

        await client.sendRequest('workspace/executeCommand', command);
        executedCommand = {
          command: command.command,
          arguments: command.arguments,
        };
      }

      const result: StandardResult<ApplyCodeActionData> = {
        data: {
          actionTitle: selectedAction.title,
          actionKind: selectedAction.kind,
          summary,
          diff,
          filesModified,
          executedCommand,
        },
        metadata: {
          processingTime: Date.now() - startTime,
          cached: false,
        },
      };

      return result;
    } catch (error) {
      if (error instanceof MCPError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for common errors
      if (errorMessage.includes('not supported')) {
        throw new MCPError(
          MCPErrorCode.NOT_SUPPORTED,
          'Code action operation not supported by this language server'
        );
      }

      throw new MCPError(
        MCPErrorCode.InternalError,
        `Failed to apply code action: ${errorMessage}`
      );
    }
  }
}
