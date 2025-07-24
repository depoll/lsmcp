import { stat } from 'fs/promises';
import { LRUCache } from './cache.js';
import { logger } from './logger.js';

interface CachedItem<T> {
  value: T;
  fileMtime: number;
}

export class FileAwareLRUCache<V> {
  private cache: LRUCache<string, CachedItem<V>>;

  constructor(maxSize: number, ttl: number) {
    this.cache = new LRUCache(maxSize, ttl);
  }

  async get(key: string, fileUri: string): Promise<V | undefined> {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    // Check if file has been modified
    try {
      const filePath = fileUri.replace('file://', '');
      const stats = await stat(filePath);
      const currentMtime = stats.mtimeMs;

      if (currentMtime > cached.fileMtime) {
        // File has been modified, invalidate cache entries for this file
        logger.debug({ key, fileUri }, 'File modified, invalidating cache entry');
        this.invalidateFile(fileUri);
        return undefined;
      }

      return cached.value;
    } catch (error) {
      // If we can't check the file, invalidate the cache to be safe
      logger.debug({ key, fileUri, error }, 'Failed to check file modification time');
      return undefined;
    }
  }

  async set(key: string, value: V, fileUri: string): Promise<void> {
    try {
      const filePath = fileUri.replace('file://', '');
      const stats = await stat(filePath);

      this.cache.set(key, {
        value,
        fileMtime: stats.mtimeMs,
      });
    } catch (error) {
      // If we can't get file stats, don't cache
      logger.debug({ key, fileUri, error }, 'Failed to get file stats, not caching');
    }
  }

  invalidateFile(fileUri: string): void {
    // Clear all cache entries for a specific file
    const prefix = fileUri + ':';
    const keysToDelete: string[] = [];

    // Note: This is a simplified approach. In a real implementation,
    // we might want to track keys by file URI more efficiently
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
    logger.debug({ fileUri, count: keysToDelete.length }, 'Invalidated cache entries for file');
  }

  clear(): void {
    this.cache.clear();
  }
}
