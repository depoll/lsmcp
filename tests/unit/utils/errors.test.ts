import { describe, it, expect } from '@jest/globals';
import {
  LSPError,
  ConnectionError,
  ServerCrashError,
  TimeoutError,
  isRecoverableError,
} from '../../../src/utils/errors.js';

describe('Error utilities', () => {
  describe('LSPError', () => {
    it('should create basic LSP error', () => {
      const error = new LSPError('Test error', 'TEST_CODE', 'typescript', '/workspace');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.language).toBe('typescript');
      expect(error.workspace).toBe('/workspace');
      expect(error.name).toBe('LSPError');
    });
  });

  describe('ConnectionError', () => {
    it('should create connection error', () => {
      const error = new ConnectionError('Failed to connect', 'python');

      expect(error.message).toBe('Failed to connect');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.language).toBe('python');
      expect(error.name).toBe('ConnectionError');
    });
  });

  describe('ServerCrashError', () => {
    it('should create server crash error', () => {
      const error = new ServerCrashError('Server crashed', 1, 'SIGTERM', 'rust', '/project');

      expect(error.message).toBe('Server crashed');
      expect(error.code).toBe('SERVER_CRASH');
      expect(error.exitCode).toBe(1);
      expect(error.signal).toBe('SIGTERM');
      expect(error.language).toBe('rust');
      expect(error.workspace).toBe('/project');
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error', () => {
      const error = new TimeoutError('Request timed out', 'java');

      expect(error.message).toBe('Request timed out');
      expect(error.code).toBe('TIMEOUT');
      expect(error.language).toBe('java');
    });
  });

  describe('isRecoverableError', () => {
    it('should identify recoverable errors', () => {
      expect(isRecoverableError(new ServerCrashError('Crash', 1, null))).toBe(true);
      expect(isRecoverableError(new TimeoutError('Timeout'))).toBe(true);
      expect(isRecoverableError(new Error('ECONNRESET: Connection reset'))).toBe(true);
      expect(isRecoverableError(new ConnectionError('Failed'))).toBe(false);
      expect(isRecoverableError(new Error('Random error'))).toBe(false);
    });
  });
});
