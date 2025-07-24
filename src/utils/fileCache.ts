import { stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { LRUCache } from './cache.js';
import { logger } from './logger.js';

interface CachedItem<T> {
  value: T;
  fileMtime: number;
}

export class FileAwareLRUCache<V> {
  private cache: LRUCache<string, CachedItem<V>>;
  private fileToKeys: Map<string, Set<string>>;

  constructor(maxSize: number, ttl: number) {
    this.cache = new LRUCache(maxSize, ttl);
    this.fileToKeys = new Map();
  }

  async get(key: string, fileUri: string): Promise<V | undefined> {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    // Check if file has been modified
    try {
      const filePath = fileURLToPath(fileUri);
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
      const filePath = fileURLToPath(fileUri);
      const stats = await stat(filePath);

      this.cache.set(key, {
        value,
        fileMtime: stats.mtimeMs,
      });

      // Update reverse index
      if (!this.fileToKeys.has(fileUri)) {
        this.fileToKeys.set(fileUri, new Set());
      }
      this.fileToKeys.get(fileUri)!.add(key);
    } catch (error) {
      // If we can't get file stats, don't cache
      logger.debug({ key, fileUri, error }, 'Failed to get file stats, not caching');
    }
  }

  invalidateFile(fileUri: string): void {
    // Clear all cache entries for a specific file using reverse index
    const keys = this.fileToKeys.get(fileUri);
    if (!keys) {
      logger.debug({ fileUri }, 'No cache entries to invalidate for file');
      return;
    }

    keys.forEach((key) => this.cache.delete(key));
    this.fileToKeys.delete(fileUri);
    logger.debug({ fileUri, count: keys.size }, 'Invalidated cache entries for file');
  }

  clear(): void {
    this.cache.clear();
    this.fileToKeys.clear();
  }
}
