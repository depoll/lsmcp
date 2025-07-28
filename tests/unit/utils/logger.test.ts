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

    it('should handle Windows paths on Windows platform', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      try {
        const path = 'C:\\Users\\user\\project\\file.ts';
        const uri = pathToFileUri(path);
        expect(uri).toBe('file:///C:/Users/user/project/file.ts');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });
  });

  describe('normalizeUri', () => {
    it('should return URIs unchanged on Unix-like systems', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      try {
        const uri = 'file:///home/user/project/file.ts';
        const normalized = normalizeUri(uri);
        expect(normalized).toBe(uri);
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it('should lowercase URIs on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      try {
        const uri = 'file:///C:/Users/USER/Project/FILE.ts';
        const normalized = normalizeUri(uri);
        expect(normalized).toBe('file:///c:/users/user/project/file.ts');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it('should handle case differences in Windows drive letters', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      try {
        const uri1 = 'file:///C:/path/to/file.ts';
        const uri2 = 'file:///c:/path/to/file.ts';
        const normalized1 = normalizeUri(uri1);
        const normalized2 = normalizeUri(uri2);
        expect(normalized1).toBe(normalized2);
        expect(normalized1).toBe('file:///c:/path/to/file.ts');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });
  });
});
