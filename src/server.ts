import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino from 'pino';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ConnectionPool } from './lsp/index.js';
import { CodeIntelligenceTool } from './tools/codeIntelligence.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class LSMCPServer {
  private server: McpServer;
  private transport: StdioServerTransport;
  private logger = pino({
    name: 'lsmcp',
    level: process.env['LOG_LEVEL'] || 'info',
  });
  private running = false;
  private version: string;
  private clientManager: ConnectionPool;

  constructor() {
    this.version = '0.1.0'; // Will be loaded from package.json

    this.server = new McpServer({
      name: 'lsmcp',
      version: this.version,
    });

    this.transport = new StdioServerTransport();
    this.clientManager = new ConnectionPool({
      idleTimeout: 5 * 60 * 1000, // 5 minutes
      healthCheckInterval: 30 * 1000, // 30 seconds
    });

    void this.loadVersion();
    this.registerTools();
  }

  private async loadVersion(): Promise<void> {
    try {
      const packagePath = join(__dirname, '..', 'package.json');
      const packageData = await readFile(packagePath, 'utf-8');
      const pkg = JSON.parse(packageData) as { version: string };
      this.version = pkg.version;
    } catch (error) {
      this.logger.warn('Failed to load version from package.json', error);
    }
  }

  private registerTools(): void {
    // Register Code Intelligence Tool
    const codeIntelligenceTool = new CodeIntelligenceTool(this.clientManager);

    // Convert the plain JSON schema to Zod schema for MCP SDK
    const inputSchema = {
      uri: z.string().describe('File URI (e.g., file:///path/to/file.ts)'),
      position: z.object({
        line: z.number().describe('Zero-based line number'),
        character: z.number().describe('Zero-based character offset'),
      }),
      type: z
        .enum(['hover', 'signature', 'completion'])
        .describe('Type of intelligence to retrieve'),
      completionContext: z
        .object({
          triggerCharacter: z
            .string()
            .optional()
            .describe('Character that triggered completion (e.g., ".")'),
          triggerKind: z
            .number()
            .optional()
            .describe('How completion was triggered (1=Invoked, 2=TriggerCharacter, 3=Incomplete)'),
        })
        .optional(),
      maxResults: z.number().default(50).describe('Maximum number of completion items to return'),
    };

    this.server.registerTool(
      codeIntelligenceTool.name,
      {
        title: 'Code Intelligence',
        description: codeIntelligenceTool.description,
        inputSchema,
      },
      async (params) => {
        const result = await codeIntelligenceTool.execute(params);

        // Convert to MCP tool response format
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );

    this.logger.info('Registered Code Intelligence tool');
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running');
    }

    this.logger.info('Starting LSMCP server...');

    // Connect the transport to the server
    await this.server.connect(this.transport);

    this.running = true;
    this.logger.info('LSMCP server started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('Server is not running');
    }

    this.logger.info('Stopping LSMCP server...');

    await this.server.close();
    await this.clientManager.disposeAll();

    this.running = false;
    this.logger.info('LSMCP server stopped');
  }
}
