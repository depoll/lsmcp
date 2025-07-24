import { z } from 'zod';
import { ConnectionPool } from '../lsp/index.js';
import { logger as baseLogger } from '../utils/logger.js';

export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<unknown>;
}

export interface BatchSupport<T, R> {
  supportsBatch: true;
  executeBatch(items: T[]): Promise<R[]>;
}

export interface StreamingSupport<T, R> {
  supportsStreaming: true;
  executeStream(params: T, onProgress: (partial: Partial<R>) => void): Promise<R>;
}

export abstract class BaseTool<TParams = unknown, TResult = unknown> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: z.ZodSchema<TParams>;

  protected logger = baseLogger.child({ tool: this.constructor.name });

  constructor(protected clientManager: ConnectionPool) {}

  abstract execute(params: TParams): Promise<TResult>;

  getMetadata(): ToolMetadata {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }

  protected validateParams(params: unknown): TParams {
    try {
      return this.inputSchema.parse(params);
    } catch (error) {
      this.logger.error({ error, params }, 'Invalid tool parameters');
      throw new Error(`Invalid parameters for tool ${this.name}: ${String(error)}`);
    }
  }
}

export abstract class BatchableTool<TParams = unknown, TResult = unknown>
  extends BaseTool<TParams, TResult>
  implements BatchSupport<TParams, TResult>
{
  supportsBatch = true as const;

  async executeBatch(items: TParams[]): Promise<TResult[]> {
    this.logger.info({ count: items.length }, 'Executing batch operation');

    const results = await Promise.allSettled(items.map((item) => this.execute(item)));

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        this.logger.error(
          { error: result.reason as Error, item: items[index] },
          'Batch item failed'
        );
        throw result.reason as Error;
      }
    });
  }
}

export abstract class StreamingTool<TParams = unknown, TResult = unknown>
  extends BaseTool<TParams, TResult>
  implements StreamingSupport<TParams, TResult>
{
  supportsStreaming = true as const;

  abstract executeStream(
    params: TParams,
    onProgress: (partial: Partial<TResult>) => void
  ): Promise<TResult>;
}

export function isBatchable<T, R>(
  tool: BaseTool<T, R>
): tool is BaseTool<T, R> & BatchSupport<T, R> {
  return 'supportsBatch' in tool && tool.supportsBatch === true;
}

export function isStreamable<T, R>(
  tool: BaseTool<T, R>
): tool is BaseTool<T, R> & StreamingSupport<T, R> {
  return 'supportsStreaming' in tool && tool.supportsStreaming === true;
}
