import {
  ProtocolConnection,
  InitializeRequest,
  InitializeParams,
  InitializeResult,
  ShutdownRequest,
  ExitNotification,
} from 'vscode-languageserver-protocol/node.js';
import { TimeoutError } from '../utils/errors.js';
import pino from 'pino';

export class ProtocolHandler {
  private logger = pino({ level: 'info' });

  constructor(
    private connection: ProtocolConnection,
    private requestTimeout: number = 5000
  ) {}

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    this.logger.info('Sending initialize request');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`Initialize request timed out after 30000ms`));
      }, 30000);
    });

    const requestPromise = this.connection.sendRequest(InitializeRequest.type, params);
    const result = await Promise.race([requestPromise, timeoutPromise]);

    // Send initialized notification
    await this.connection.sendNotification('initialized', {});

    return result;
  }

  async shutdown(): Promise<void> {
    this.logger.info('Sending shutdown request');

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(`Shutdown request timed out after 5000ms`));
        }, 5000);
      });

      const requestPromise = this.connection.sendRequest(ShutdownRequest.type);
      await Promise.race([requestPromise, timeoutPromise]);

      await this.connection.sendNotification(ExitNotification.type);
    } catch (error) {
      this.logger.warn('Error during shutdown:', error);
      // Force exit notification even if shutdown fails
      await this.connection.sendNotification(ExitNotification.type);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(`Ping request timed out after ${this.requestTimeout}ms`));
        }, this.requestTimeout);
      });

      const requestPromise = this.connection.sendRequest('$/ping', {});
      await Promise.race([requestPromise, timeoutPromise]);
      return true;
    } catch (error) {
      this.logger.debug('Ping failed:', error);
      return false;
    }
  }

  async sendRequest<P = any, R = any>(
    method: string,
    params: P,
    options?: { timeout?: number }
  ): Promise<R> {
    const timeout = options?.timeout || this.requestTimeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`Request ${method} timed out after ${timeout}ms`));
      }, timeout);
    });

    const requestPromise = this.connection.sendRequest<P, R>(method, params);
    return Promise.race([requestPromise, timeoutPromise]);
  }

  dispose(): void {
    this.connection.dispose();
  }
}
