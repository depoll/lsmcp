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

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Initialize request timed out after 30000ms`));
      }, 30000);
      timeoutId.unref();
    });

    const requestPromise = this.connection.sendRequest(InitializeRequest.type, params);
    const result = await Promise.race([requestPromise, timeoutPromise]);

    // Clean up timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Send initialized notification
    await this.connection.sendNotification('initialized', {});

    return result;
  }

  async shutdown(): Promise<void> {
    this.logger.info('Sending shutdown request');

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TimeoutError(`Shutdown request timed out after 5000ms`));
        }, 5000);
      });

      const requestPromise = this.connection.sendRequest(ShutdownRequest.type);
      await Promise.race([requestPromise, timeoutPromise]);

      // Clear the timeout since the request completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      await this.connection.sendNotification(ExitNotification.type);
    } catch (error) {
      this.logger.warn('Error during shutdown:', error);
      // Force exit notification even if shutdown fails
      await this.connection.sendNotification(ExitNotification.type);
    }
  }

  async ping(): Promise<boolean> {
    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TimeoutError(`Ping request timed out after ${this.requestTimeout}ms`));
        }, this.requestTimeout);
      });

      const requestPromise = this.connection.sendRequest('$/ping', {});
      await Promise.race([requestPromise, timeoutPromise]);

      // Clear the timeout since the request completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return true;
    } catch (error) {
      this.logger.debug('Ping failed:', error);
      return false;
    }
  }

  async sendRequest<R = unknown>(
    method: string,
    params?: unknown,
    options?: { timeout?: number }
  ): Promise<R> {
    const timeout = options?.timeout || this.requestTimeout;

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Request ${method} timed out after ${timeout}ms`));
      }, timeout);
    });

    // Use the untyped string-based sendRequest overload
    const requestPromise: Promise<R> = this.connection.sendRequest(method, params);
    const result = await Promise.race([requestPromise, timeoutPromise]);

    // Clear the timeout since the request completed successfully
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return result;
  }

  dispose(): void {
    this.connection.dispose();
  }
}
