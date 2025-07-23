import { EventEmitter } from 'events';
import { ServerCapabilities } from 'vscode-languageserver-protocol';
import { LanguageServerConfig } from '../types/lsp.js';

export class MockLSPClient extends EventEmitter {
  private connected = false;
  private capabilities: ServerCapabilities = {
    textDocumentSync: 1,
    completionProvider: {},
  };

  constructor(
    private readonly id: string,
    private readonly config: LanguageServerConfig,
    _options: Record<string, unknown> = {}
  ) {
    super();
  }

  start(): void {
    if (this.config.command === 'error') {
      throw new Error('Mock error');
    }
    this.connected = true;
  }

  stop(): void {
    if (!this.connected) {
      throw new Error('Client is not connected');
    }
    this.connected = false;
  }

  ping(): boolean {
    if (this.config.command === 'unhealthy') {
      return false;
    }
    return this.connected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCapabilities(): ServerCapabilities | null {
    return this.connected ? this.capabilities : null;
  }

  getId(): string {
    return this.id;
  }

  simulateCrash(): void {
    this.connected = false;
    this.emit('crash', { code: 1, signal: null });
  }
}
