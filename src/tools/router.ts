import {
  CallToolRequest,
  CallToolResult,
  ServerNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

export interface ProgressCallback {
  (progress: { done: number; total?: number; message?: string }): void;
}

export interface RouterOptions {
  enableBatching?: boolean;
  enableStreaming?: boolean;
  maxConcurrentRequests?: number;
}

export class ToolRouter {
  private logger = logger.child({ component: 'ToolRouter' });
  private activeRequests = new Map<string | number, AbortController>();

  constructor(
    private registry: ToolRegistry,
    private options: RouterOptions = {}
  ) {
    this.options = {
      enableBatching: true,
      enableStreaming: true,
      maxConcurrentRequests: 10,
      ...options,
    };
  }

  async route(
    request: CallToolRequest,
    callbacks?: {
      onProgress?: (notification: ServerNotification) => void;
      onCancel?: () => void;
    }
  ): Promise<CallToolResult> {
    const progressToken = request.params._meta?.progressToken;
    const startTime = Date.now();

    // Create abort controller for cancellation
    const abortController = new AbortController();
    if (progressToken) {
      this.activeRequests.set(progressToken, abortController);
    }

    // Setup cancellation handler
    if (callbacks?.onCancel) {
      abortController.signal.addEventListener('abort', callbacks.onCancel);
    }

    try {
      this.logger.info(
        {
          tool: request.params.name,
          hasProgressToken: !!progressToken,
          hasBatch: !!request.params.arguments?.['batch'],
        },
        'Routing tool request'
      );

      // Execute with progress if streaming is enabled and supported
      let result: unknown;

      if (this.options.enableStreaming && progressToken && callbacks?.onProgress) {
        result = await this.executeWithProgress(request, (partial) => {
          if (abortController.signal.aborted) {
            throw new Error('Request cancelled');
          }

          callbacks.onProgress!({
            method: 'notifications/progress' as const,
            params: {
              progressToken,
              progress: partial,
            },
          } as ServerNotification);
        });
      } else {
        // Regular execution
        result = await this.registry.execute(request);
      }

      const duration = Date.now() - startTime;
      this.logger.info(
        {
          tool: request.params.name,
          duration,
          resultType: typeof result,
        },
        'Tool request completed'
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        {
          tool: request.params.name,
          error,
          duration,
        },
        'Tool request failed'
      );

      throw error;
    } finally {
      // Clean up
      if (progressToken) {
        this.activeRequests.delete(progressToken);
      }
    }
  }

  private async executeWithProgress(
    request: CallToolRequest,
    onProgress: (partial: unknown) => void
  ): Promise<unknown> {
    return this.registry.executeWithProgress(request, onProgress);
  }

  async routeBatch(
    requests: CallToolRequest[],
    callbacks?: {
      onProgress?: (index: number, notification: ServerNotification) => void;
      onCancel?: () => void;
    }
  ): Promise<CallToolResult[]> {
    if (!this.options.enableBatching) {
      throw new Error('Batching is disabled');
    }

    const startTime = Date.now();

    this.logger.info({ count: requests.length }, 'Processing batch of tool requests');

    // Group requests by tool for optimal batching
    const groupedRequests = this.groupRequestsByTool(requests);
    const results = new Map<number, CallToolResult>();

    try {
      // Process each group
      for (const [toolName, group] of groupedRequests.entries()) {
        this.logger.debug({ tool: toolName, count: group.length }, 'Processing tool group');

        // Check if tool supports native batching
        const registration = this.registry.get(toolName);
        if (!registration) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        // Execute requests in parallel (up to max concurrent)
        const chunks = this.chunkArray(group, this.options.maxConcurrentRequests!);

        for (const chunk of chunks) {
          const chunkResults = await Promise.all(
            chunk.map(async ({ request, originalIndex }) => {
              try {
                const result = await this.route(request, {
                  onProgress: callbacks?.onProgress
                    ? (notification) => callbacks.onProgress!(originalIndex, notification)
                    : undefined,
                  onCancel: callbacks?.onCancel,
                });

                return { originalIndex, result };
              } catch (error) {
                return {
                  originalIndex,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          error: String(error),
                          tool: toolName,
                        }),
                      },
                    ],
                    isError: true,
                  } as CallToolResult,
                };
              }
            })
          );

          // Store results in original order
          for (const { originalIndex, result } of chunkResults) {
            results.set(originalIndex, result);
          }
        }
      }

      const duration = Date.now() - startTime;
      this.logger.info({ count: requests.length, duration }, 'Batch processing completed');

      // Return results in original order
      return Array.from(
        { length: requests.length },
        (_, i) =>
          results.get(i) ||
          ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'No result for index ' + i }),
              },
            ],
            isError: true,
          } as CallToolResult)
      );
    } catch (error) {
      this.logger.error({ error, count: requests.length }, 'Batch processing failed');
      throw error;
    }
  }

  private groupRequestsByTool(
    requests: CallToolRequest[]
  ): Map<string, Array<{ request: CallToolRequest; originalIndex: number }>> {
    const groups = new Map<string, Array<{ request: CallToolRequest; originalIndex: number }>>();

    requests.forEach((request, index) => {
      const toolName = request.params.name;
      const group = groups.get(toolName) || [];
      group.push({ request, originalIndex: index });
      groups.set(toolName, group);
    });

    return groups;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  cancelRequest(progressToken: string | number): boolean {
    const controller = this.activeRequests.get(progressToken);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(progressToken);
      this.logger.info({ progressToken }, 'Request cancelled');
      return true;
    }
    return false;
  }

  getActiveRequests(): Array<string | number> {
    return Array.from(this.activeRequests.keys());
  }
}
