import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino from 'pino';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ConnectionPool } from './lsp/index.js';
import { CodeIntelligenceTool } from './tools/codeIntelligence.js';
import { NavigateTool } from './tools/navigate.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolRouter } from './tools/router.js';
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
  private toolRegistry: ToolRegistry;
  private toolRouter: ToolRouter;

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

    this.toolRegistry = new ToolRegistry();
    this.toolRouter = new ToolRouter(this.toolRegistry, {
      enableBatching: true,
      enableStreaming: true,
      maxConcurrentRequests: 10,
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
    this.toolRegistry.register(codeIntelligenceTool);

    // Register Navigate Tool
    const navigateTool = new NavigateTool(this.clientManager);
    this.toolRegistry.register(navigateTool);

    // Register all tools with MCP server
    for (const registration of this.toolRegistry.getAll()) {
      const { metadata } = registration;

      // Extract the shape from the Zod schema for MCP SDK compatibility
      let inputSchema: z.ZodRawShape;

      if (metadata.inputSchema instanceof z.ZodObject) {
        // For ZodObject schemas, extract the shape
        const zodObject = metadata.inputSchema as z.ZodObject<z.ZodRawShape>;
        inputSchema = zodObject.shape;
      } else {
        // For other schema types, we need to handle them appropriately
        // For now, log a warning and use an empty shape
        this.logger.warn(
          `Tool ${metadata.name} has a non-ZodObject schema type. Using empty shape.`
        );
        inputSchema = {};
      }

      this.server.registerTool(
        metadata.name,
        {
          title: metadata.name,
          description: metadata.description,
          inputSchema,
        },
        (
          params: unknown,
          callbacks?: {
            _meta?: { progressToken?: string | number };
            onProgress?: (notification: unknown) => void;
          }
        ) => {
          // Route through the tool router for consistent handling
          return this.toolRouter.route(
            {
              method: 'tools/call',
              params: {
                name: metadata.name,
                arguments: params as Record<string, unknown> | undefined,
                _meta: callbacks?._meta,
              },
            },
            {
              onProgress: callbacks?.onProgress,
            }
          );
        }
      );
    }

    this.logger.info(
      { count: this.toolRegistry.getAll().length },
      'Registered tools with MCP server'
    );
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
