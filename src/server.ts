import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino from 'pino';
import { HealthCheckResponse } from './types/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MCPServer {
  private server: Server;
  private transport: StdioServerTransport;
  private logger = pino({ level: 'info' });
  private startTime: number;
  private running = false;
  private version: string;

  constructor() {
    this.startTime = Date.now();
    this.version = '0.1.0'; // Will be loaded from package.json

    this.server = new Server(
      {
        name: 'lsmcp',
        version: this.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.transport = new StdioServerTransport();
    void this.loadVersion();
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

  handleHealthCheck(): HealthCheckResponse {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: 'healthy',
      version: this.version,
      uptime: uptimeSeconds,
    };
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

    this.running = false;
    this.logger.info('LSMCP server stopped');
  }
}
