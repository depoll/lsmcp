import { logger as baseLogger } from './logger.js';

const logger = baseLogger.child({ component: 'retry' });

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 500,
  backoffMultiplier: 1.5,
  shouldRetry: (error: unknown) => {
    // Retry on empty results or specific LSP errors that indicate indexing issues
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('not indexed') ||
        message.includes('indexing') ||
        message.includes('not found') ||
        message.includes('no results')
      );
    }
    return false;
  },
  onRetry: (error: unknown, attempt: number) => {
    logger.warn({ error, attempt }, 'Retrying LSP operation due to indexing lag');
  },
};

/**
 * Retry an async operation with exponential backoff
 * @param operation The async operation to retry
 * @param options Retry configuration options
 * @returns The result of the operation
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await operation();

      // Check for empty results that might indicate indexing lag
      if (isEmptyResult(result) && attempt < opts.maxAttempts) {
        const error = new Error('Empty result, possibly due to indexing lag');
        if (opts.shouldRetry(error, attempt)) {
          opts.onRetry(error, attempt);
          await delay(opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1));
          continue;
        }
      }

      return result;
    } catch (error) {
      lastError = error;

      if (attempt < opts.maxAttempts && opts.shouldRetry(error, attempt)) {
        opts.onRetry(error, attempt);
        await delay(opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Check if a result is empty (null, undefined, or empty array)
 */
function isEmptyResult(result: unknown): boolean {
  return result === null || result === undefined || (Array.isArray(result) && result.length === 0);
}

/**
 * Delay execution for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper for LSP read operations
 * Specifically tuned for LSP indexing lag scenarios
 */
export function createLSPRetryWrapper<T extends (...args: unknown[]) => Promise<unknown>>(
  operation: T,
  customOptions?: RetryOptions
): T {
  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const result = await retryWithBackoff(() => operation(...args), {
      maxAttempts: 3,
      delayMs: 1000, // Start with 1 second for LSP indexing
      backoffMultiplier: 2, // Double the delay each time
      ...customOptions,
    });
    return result as Awaited<ReturnType<T>>;
  }) as T;
}
