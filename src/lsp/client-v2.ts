import { EventEmitter } from 'events';
import {
  createProtocolConnection,
  ProtocolConnection,
  InitializeParams,
  ServerCapabilities,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node.js';
import { LanguageServerConfig } from '../types/lsp.js';
import { ProcessManager } from './process-manager.js';
import { ProtocolHandler } from './protocol-handler.js';
import { ServerCrashError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface LSPClientOptions {
  startTimeout?: number;
  requestTimeout?: number;
  workspaceFolders?: string[];
}

export class LSPClientV2 extends EventEmitter {
  private processManager: ProcessManager;
  private protocolHandler: ProtocolHandler | null = null;
  private connection: ProtocolConnection | null = null;
  private capabilities: ServerCapabilities | null = null;
  private logger = logger;
  private connected = false;
  private startTime: number = Date.now();

  constructor(
    private readonly id: string,
    private readonly config: LanguageServerConfig,
    private readonly options: LSPClientOptions = {}
  ) {
    super();
    this.options.startTimeout = this.options.startTimeout ?? 30000;
    this.options.requestTimeout = this.options.requestTimeout ?? 5000;

    this.processManager = new ProcessManager(this.config, this.options.startTimeout);
    this.setupProcessListeners();
  }

  private setupProcessListeners(): void {
    this.processManager.on('crash', (error: ServerCrashError) => {
      this.connected = false;
      this.emit('crash', error);
    });

    this.processManager.on('stderr', (message: string) => {
      this.emit('error', new Error(`Language server error: ${message}`));
    });
  }

  async start(): Promise<void> {
    if (this.connected) {
      throw new Error('Client is already connected');
    }

    this.logger.info(`Starting language server: ${this.id}`);
    this.startTime = Date.now();

    try {
      // Start the process
      this.logger.info(`Starting process for language server: ${this.id}`);
      const streams = await this.processManager.start();
      this.logger.info(`Process started successfully for: ${this.id}`);

      // Create protocol connection
      const reader = new StreamMessageReader(streams.reader);
      const writer = new StreamMessageWriter(streams.writer);

      this.connection = createProtocolConnection(reader, writer);
      this.protocolHandler = new ProtocolHandler(this.connection, this.options.requestTimeout);

      this.connection.onError((error) => {
        this.logger.error('Protocol error:', error);
        this.emit('error', error);
      });

      this.connection.onClose(() => {
        this.logger.info('Protocol connection closed');
        this.connected = false;
      });

      // Start listening
      this.connection.listen();
      this.logger.info(`Protocol connection listening for: ${this.id}`);

      // Initialize
      const initParams: InitializeParams = {
        processId: process.pid,
        capabilities: {},
        rootUri: this.options.workspaceFolders?.[0]
          ? this.toFileUri(this.options.workspaceFolders[0])
          : null,
        workspaceFolders:
          this.options.workspaceFolders?.map((folder) => ({
            uri: this.toFileUri(folder),
            name: folder.split('/').pop() || folder,
          })) || null,
        initializationOptions: this.config.initializationOptions,
      };

      this.logger.info('Sending initialize request', {
        rootUri: initParams.rootUri,
        workspaceFolders: initParams.workspaceFolders,
      });
      const result = await this.protocolHandler.initialize(initParams);
      this.capabilities = result.capabilities;
      this.connected = true;

      this.logger.info(`Language server initialized successfully: ${this.id}`);
    } catch (error) {
      this.logger.error(`Failed to start language server ${this.id}:`, error);
      await this.cleanup();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.connected) {
      throw new Error('Client is not connected');
    }

    this.logger.info(`Stopping language server: ${this.id}`);

    try {
      if (this.protocolHandler) {
        await this.protocolHandler.shutdown();
      }
    } catch (error) {
      this.logger.warn('Error during shutdown:', error);
    }

    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.connected = false;

    if (this.protocolHandler) {
      this.protocolHandler.dispose();
      this.protocolHandler = null;
    }

    this.connection = null;
    await this.processManager.stop();
  }

  async ping(): Promise<boolean> {
    if (!this.connected || !this.protocolHandler) {
      return false;
    }

    return this.protocolHandler.ping();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCapabilities(): ServerCapabilities | null {
    return this.capabilities;
  }

  getId(): string {
    return this.id;
  }

  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  async sendRequest<R = unknown>(method: string, params?: unknown): Promise<R> {
    if (!this.protocolHandler) {
      throw new Error('Client is not connected');
    }

    return this.protocolHandler.sendRequest<R>(method, params);
  }

  sendNotification(method: string, params?: unknown): void {
    if (!this.connection) {
      throw new Error('Client is not connected');
    }

    void this.connection.sendNotification(method, params);
  }

  /**
   * Convert a filesystem path to a file:// URI
   */
  private toFileUri(path: string): string {
    if (path.startsWith('file://')) {
      return path;
    }

    // Unix-style paths in container environment
    return `file://${path}`;
  }
}
