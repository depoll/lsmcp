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
    
    const result = await this.sendRequestWithTimeout(
      InitializeRequest.type,
      params,
      30000 // 30s timeout for initialization
    );
    
    // Send initialized notification
    await this.connection.sendNotification('initialized', {});
    
    return result;
  }

  async shutdown(): Promise<void> {
    this.logger.info('Sending shutdown request');
    
    try {
      await this.sendRequestWithTimeout(ShutdownRequest.type, undefined, 5000);
      await this.connection.sendNotification(ExitNotification.type);
    } catch (error) {
      this.logger.warn('Error during shutdown:', error);
      // Force exit notification even if shutdown fails
      await this.connection.sendNotification(ExitNotification.type);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.sendRequestWithTimeout('$/ping', {}, this.requestTimeout);
      return true;
    } catch (error) {
      this.logger.debug('Ping failed:', error);
      return false;
    }
  }

  async sendRequest<P, R>(method: string, params: P): Promise<R> {
    return this.sendRequestWithTimeout(method, params, this.requestTimeout);
  }

  private async sendRequestWithTimeout<P, R>(
    method: string | { method: string },
    params: P,
    timeout: number
  ): Promise<R> {
    const methodName = typeof method === 'string' ? method : method.method;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`Request ${methodName} timed out after ${timeout}ms`));
      }, timeout);
    });

    const requestPromise = typeof method === 'string'
      ? this.connection.sendRequest(method, params)
      : this.connection.sendRequest(method, params);

    return Promise.race([requestPromise as Promise<R>, timeoutPromise]);
  }

  dispose(): void {
    this.connection.dispose();
  }
}