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
  private keyToFile: Map<string, string>;

  constructor(maxSize: number, ttl: number) {
    this.cache = new LRUCache(maxSize, ttl);
    this.fileToKeys = new Map();
    this.keyToFile = new Map();
  }

  async get(key: string, fileUri: string): Promise<V | undefined> {
    const cached = this.cache.get(key);
    if (!cached) {
      // Clean up stale entries from reverse indices
      this.cleanupKey(key);
      return undefined;
    }

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

      // Update reverse indices
      if (!this.fileToKeys.has(fileUri)) {
        this.fileToKeys.set(fileUri, new Set());
      }
      this.fileToKeys.get(fileUri)!.add(key);
      this.keyToFile.set(key, fileUri);
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
    this.keyToFile.clear();
  }

  private cleanupKey(key: string): void {
    const fileUri = this.keyToFile.get(key);
    if (fileUri) {
      const keys = this.fileToKeys.get(fileUri);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.fileToKeys.delete(fileUri);
        }
      }
      this.keyToFile.delete(key);
    }
  }
}
