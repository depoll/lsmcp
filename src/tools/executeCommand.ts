import { z } from 'zod';
import { BaseTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { MCPError, MCPErrorCode, StandardResult } from './common-types.js';
import { ExecuteCommandParams } from 'vscode-languageserver-protocol';

// Input schema for the execute command tool
// Using z.any() instead of z.unknown() for better MCP client compatibility
const ExecuteCommandParamsSchema = z.object({
  command: z.string().describe('Command identifier to execute'),
  arguments: z.array(z.any()).optional().describe('Command-specific arguments'),
  language: z
    .string()
    .optional()
    .describe(
      'Language server to send the command to (e.g., "typescript", "python"). If not specified, tries all active servers.'
    ),
});

export type ExecuteCommandToolParams = z.infer<typeof ExecuteCommandParamsSchema>;

/**
 * Result data for executing a command
 */
interface ExecuteCommandData {
  /**
   * The command that was executed
   */
  command: string;

  /**
   * Arguments passed to the command
   */
  arguments?: unknown[];

  /**
   * Result returned by the command (if any)
   */
  result?: unknown;

  /**
   * Language server that executed the command
   */
  executedBy?: string;

  /**
   * Servers that failed to execute (if any)
   */
  failedServers?: string[];
}

/**
 * Tool for executing language server commands using LSP workspace/executeCommand
 *
 * This tool provides access to language-specific commands registered by language servers.
 * Commands can perform various operations like generating code, adding imports, or
 * triggering custom refactorings.
 */
export class ExecuteCommandTool extends BaseTool<
  ExecuteCommandToolParams,
  StandardResult<ExecuteCommandData>
> {
  readonly name = 'executeCommand';
  readonly description = `Execute language server commands using LSP.

Executes language-specific commands registered by language servers.
Can target specific language servers or try all active ones.

Common Commands (varies by language server):
- TypeScript:
  - "_typescript.organizeImports" - Organize import statements
  - "_typescript.fixAll" - Fix all auto-fixable problems
  - "typescript.tsserver.restart" - Restart TypeScript server
  
- Python:
  - "python.refactorExtractMethod" - Extract method
  - "python.refactorExtractVariable" - Extract variable
  - "python.sortImports" - Sort import statements

Examples:
1. Organize TypeScript imports:
   await executeCommand({ 
     command: "_typescript.organizeImports",
     arguments: ["file:///src/app.ts"],
     language: "typescript"
   });

2. Restart language server:
   await executeCommand({ 
     command: "typescript.tsserver.restart",
     language: "typescript"
   });

3. Execute custom command:
   await executeCommand({
     command: "myExtension.customCommand",
     arguments: [{ foo: "bar" }]
   });`;

  readonly inputSchema = ExecuteCommandParamsSchema;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: ExecuteCommandToolParams): Promise<StandardResult<ExecuteCommandData>> {
    const validated = this.validateParams(params);

    // Build the execute command params
    const executeParams: ExecuteCommandParams = {
      command: validated.command,
      arguments: validated.arguments,
    };

    // If a specific language is specified, use that server
    if (validated.language) {
      const connection = await this.clientManager.get(validated.language, process.cwd());

      if (!connection) {
        throw new MCPError(
          MCPErrorCode.InternalError,
          `No language server available for ${validated.language}`
        );
      }

      try {
        const result = await connection.sendRequest<unknown>(
          'workspace/executeCommand',
          executeParams
        );

        return {
          data: {
            command: validated.command,
            arguments: validated.arguments,
            result,
            executedBy: validated.language,
          },
          metadata: {
            processingTime: Date.now(),
            cached: false,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found') || errorMessage.includes('unknown command')) {
          throw new MCPError(
            MCPErrorCode.InvalidRequest,
            `Command "${validated.command}" not supported by ${validated.language} language server`
          );
        }

        throw new MCPError(
          MCPErrorCode.InternalError,
          `Failed to execute command: ${errorMessage}`
        );
      }
    }

    // Try all active language servers
    const activeConnections = this.clientManager.getAllActive();

    if (activeConnections.length === 0) {
      throw new MCPError(MCPErrorCode.InternalError, 'No active language servers available');
    }

    const failedServers: string[] = [];
    let successfulResult: unknown;
    let executedBy: string | undefined;

    // Try each active server until one succeeds (with timeout per attempt)
    const COMMAND_TIMEOUT = 5000; // 5 seconds per server attempt

    for (const { language, connection } of activeConnections) {
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Command execution timeout')), COMMAND_TIMEOUT);
        });

        // Race between the command execution and timeout
        const result = await Promise.race([
          connection.sendRequest<unknown>('workspace/executeCommand', executeParams),
          timeoutPromise,
        ]);

        successfulResult = result;
        executedBy = language;
        break; // Stop after first success
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only log as failed if it's not just "command not found" or timeout
        if (
          !errorMessage.includes('not found') &&
          !errorMessage.includes('unknown command') &&
          !errorMessage.includes('timeout')
        ) {
          failedServers.push(language);
        }

        this.logger.debug(`Command execution failed on ${language} server`, { error });
      }
    }

    if (!executedBy) {
      throw new MCPError(
        MCPErrorCode.InvalidRequest,
        `Command "${validated.command}" not supported by any active language server`
      );
    }

    return {
      data: {
        command: validated.command,
        arguments: validated.arguments,
        result: successfulResult,
        executedBy,
        failedServers: failedServers.length > 0 ? failedServers : undefined,
      },
      metadata: {
        processingTime: Date.now(),
        cached: false,
      },
    };
  }
}
