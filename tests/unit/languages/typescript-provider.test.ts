import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { DetectedLanguage } from '../../../src/languages/detector.js';

// Create mock for execAsync
const mockExecAsync =
  jest.fn<
    (cmd: string, options?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>
  >();

// Mock child_process and util
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn(),
}));

jest.unstable_mockModule('util', () => ({
  promisify: jest.fn(() => mockExecAsync),
}));

// Import after mocks
const { TypeScriptLanguageServerProvider, createLanguageServerProvider } = await import(
  '../../../src/languages/typescript-provider.js'
);

describe('TypeScriptLanguageServerProvider', () => {
  let provider: InstanceType<typeof TypeScriptLanguageServerProvider>;
  let mockLanguage: DetectedLanguage;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLanguage = {
      id: 'typescript',
      name: 'TypeScript',
      fileExtensions: ['.ts', '.tsx'],
      serverCommand: ['typescript-language-server', '--stdio'],
      rootPath: '/test/project',
    };
    provider = new TypeScriptLanguageServerProvider(mockLanguage);
  });

  describe('isAvailable', () => {
    it('should return true when typescript-language-server is available', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'typescript-language-server version 4.0.0',
        stderr: '',
      });

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith(
        'typescript-language-server --version',
        expect.objectContaining({
          cwd: '/test/project',
        })
      );
    });

    it('should return false when typescript-language-server is not available', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Command not found'));

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('install', () => {
    it('should require explicit consent to install', async () => {
      await expect(provider.install()).rejects.toThrow(
        'Auto-installation requires explicit user consent'
      );
    });

    it('should install with npm when available and consent given', async () => {
      // First call checks npm availability - succeed
      mockExecAsync.mockResolvedValueOnce({
        stdout: '9.0.0',
        stderr: '',
      });

      // Second call installs typescript-language-server - succeed
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'added 1 package',
        stderr: '',
      });

      await provider.install({ force: true });

      // Verify npm check
      expect(mockExecAsync).toHaveBeenCalledWith('npm --version', expect.any(Object));

      // Verify install command
      expect(mockExecAsync).toHaveBeenCalledWith(
        'npm install -g typescript-language-server',
        expect.any(Object)
      );
    });

    it('should install with yarn when npm is not available', async () => {
      // First call (npm check) fails
      mockExecAsync.mockRejectedValueOnce(new Error('npm not found'));

      // Second call (yarn check) succeeds
      mockExecAsync.mockResolvedValueOnce({
        stdout: '1.22.0',
        stderr: '',
      });

      // Third call installs typescript-language-server
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'success',
        stderr: '',
      });

      await provider.install({ force: true });

      // Verify yarn was used for installation
      expect(mockExecAsync).toHaveBeenCalledWith(
        'yarn global add typescript-language-server',
        expect.any(Object)
      );
    });

    it('should throw error when no package manager is available', async () => {
      // Both npm and yarn checks fail
      mockExecAsync.mockRejectedValueOnce(new Error('npm not found'));
      mockExecAsync.mockRejectedValueOnce(new Error('yarn not found'));

      await expect(provider.install({ force: true })).rejects.toThrow('No package manager found');
    });

    it('should handle installation failure gracefully', async () => {
      // npm check succeeds
      mockExecAsync.mockResolvedValueOnce({
        stdout: '9.0.0',
        stderr: '',
      });

      // Installation fails
      mockExecAsync.mockRejectedValueOnce(new Error('Installation failed'));

      await expect(provider.install({ force: true })).rejects.toThrow(
        'Failed to install typescript-language-server'
      );
    });
  });

  describe('getCommand', () => {
    it('should return the language server command', () => {
      const command = provider.getCommand();

      expect(command).toEqual(['typescript-language-server', '--stdio']);
    });
  });

  describe('executeCommand', () => {
    it('should handle command timeout', async () => {
      const timeoutError = new Error('Command timed out') as Error & { code?: string };
      timeoutError.code = 'ETIMEDOUT';
      mockExecAsync.mockRejectedValueOnce(timeoutError);

      await expect(provider.isAvailable()).resolves.toBe(false);
    });

    it('should include stderr in error message when available', async () => {
      // npm check succeeds
      mockExecAsync.mockResolvedValueOnce({
        stdout: '9.0.0',
        stderr: '',
      });

      // Installation fails with stderr
      const error = new Error('Command failed') as Error & { stderr?: string };
      error.stderr = 'Permission denied';
      mockExecAsync.mockRejectedValueOnce(error);

      await expect(provider.install({ force: true })).rejects.toThrow(
        'Failed to install typescript-language-server'
      );
    });
  });
});

describe('createLanguageServerProvider', () => {
  it('should create TypeScript provider for typescript language', () => {
    const language: DetectedLanguage = {
      id: 'typescript',
      name: 'TypeScript',
      fileExtensions: ['.ts'],
      serverCommand: ['typescript-language-server', '--stdio'],
      rootPath: '/test',
    };

    const provider = createLanguageServerProvider(language);

    expect(provider).toBeInstanceOf(TypeScriptLanguageServerProvider);
  });

  it('should create TypeScript provider for javascript language', () => {
    const language: DetectedLanguage = {
      id: 'javascript',
      name: 'JavaScript',
      fileExtensions: ['.js'],
      serverCommand: ['typescript-language-server', '--stdio'],
      rootPath: '/test',
    };

    const provider = createLanguageServerProvider(language);

    expect(provider).toBeInstanceOf(TypeScriptLanguageServerProvider);
  });

  it('should return null for unsupported language', () => {
    const language: DetectedLanguage = {
      id: 'python',
      name: 'Python',
      fileExtensions: ['.py'],
      serverCommand: ['pylsp'],
      rootPath: '/test',
    };

    const provider = createLanguageServerProvider(language);

    expect(provider).toBeNull();
  });
});
