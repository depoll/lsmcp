import { describe, it, expect } from '@jest/globals';
import { pathToFileUri, normalizeUri } from '../../../src/utils/logger.js';

describe('Logger Utils', () => {
  describe('pathToFileUri', () => {
    it('should convert Unix paths to file URIs', () => {
      const path = '/home/user/project/file.ts';
      const uri = pathToFileUri(path);
      expect(uri).toBe('file:///home/user/project/file.ts');
    });

    it('should return existing file URIs unchanged', () => {
      const uri = 'file:///home/user/project/file.ts';
      const result = pathToFileUri(uri);
      expect(result).toBe(uri);
    });

    it('should handle relative paths', () => {
      const path = 'relative/path/file.ts';
      const uri = pathToFileUri(path);
      expect(uri).toBe('file:///relative/path/file.ts');
    });
  });

  describe('normalizeUri', () => {
    it('should return URIs unchanged in container environment', () => {
      const uri = 'file:///home/user/project/file.ts';
      const normalized = normalizeUri(uri);
      expect(normalized).toBe(uri);
    });

    it('should preserve case-sensitive paths', () => {
      const uri = 'file:///Path/To/File.ts';
      const normalized = normalizeUri(uri);
      expect(normalized).toBe(uri);
    });
  });
});
