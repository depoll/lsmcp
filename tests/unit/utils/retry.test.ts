import { retryWithBackoff } from '../../../src/utils/retry.js';
import { jest } from '@jest/globals';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return result on first successful attempt', async () => {
    const mockOperation = jest.fn<() => Promise<string>>().mockResolvedValue('success');

    const result = await retryWithBackoff(mockOperation);

    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const mockOperation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('No results found - possible indexing lag'))
      .mockRejectedValueOnce(new Error('No results found - possible indexing lag'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(mockOperation, {
      maxAttempts: 3,
      delayMs: 10, // Short delay for testing
      shouldRetry: (error: unknown) => {
        if (error instanceof Error) {
          return error.message.includes('No results found');
        }
        return false;
      },
    });

    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts', async () => {
    const mockOperation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error('No results found - possible indexing lag'));

    await expect(
      retryWithBackoff(mockOperation, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: (error: unknown) => {
          if (error instanceof Error) {
            return error.message.includes('No results found');
          }
          return false;
        },
      })
    ).rejects.toThrow('No results found - possible indexing lag');

    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should not retry if shouldRetry returns false', async () => {
    const mockOperation = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('Different error'));

    await expect(
      retryWithBackoff(mockOperation, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: (error: unknown) => {
          if (error instanceof Error) {
            return error.message.includes('No results found');
          }
          return false;
        },
      })
    ).rejects.toThrow('Different error');

    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  it('should retry on empty results when configured', async () => {
    const mockOperation = jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['result1', 'result2']);

    const result = await retryWithBackoff(mockOperation, {
      maxAttempts: 3,
      delayMs: 10,
    });

    expect(result).toEqual(['result1', 'result2']);
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry callback', async () => {
    const mockOperation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('No results found'))
      .mockResolvedValueOnce('success');

    const onRetry = jest.fn();

    const result = await retryWithBackoff(mockOperation, {
      maxAttempts: 2,
      delayMs: 10,
      shouldRetry: () => true,
      onRetry,
    });

    expect(result).toBe('success');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('should use exponential backoff', async () => {
    const mockOperation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockResolvedValueOnce('success');

    const startTime = Date.now();

    const result = await retryWithBackoff(mockOperation, {
      maxAttempts: 3,
      delayMs: 100,
      backoffMultiplier: 2,
      shouldRetry: () => true,
    });

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    expect(result).toBe('success');
    expect(mockOperation).toHaveBeenCalledTimes(3);
    // Should wait approximately 100ms + 200ms = 300ms (with some tolerance)
    expect(totalTime).toBeGreaterThanOrEqual(250);
    expect(totalTime).toBeLessThan(400);
  });
});
