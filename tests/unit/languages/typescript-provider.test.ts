import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { TypeScriptLanguageServerProvider } from '../../../src/languages/typescript-provider.js';
import type { DetectedLanguage } from '../../../src/languages/detector.js';

// Mock child_process
const mockSpawn = jest.fn();
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

// Import after mocks
const { TypeScriptLanguageServerProvider: Provider, createLanguageServerProvider } = await import(
  '../../../src/languages/typescript-provider.js'
);

describe('TypeScriptLanguageServerProvider', () => {
  let provider: TypeScriptLanguageServerProvider;
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
    provider = new Provider(mockLanguage);
  });

  describe('isAvailable', () => {
    it('should return true when typescript-language-server is available', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate successful command
      setTimeout(() => {
        const onMock = mockProcess.on as jest.Mock;
        const closeCallback = onMock.mock.calls.find((call) => call[0] === 'close')?.[1] as (
          code: number
        ) => void;
        closeCallback?.(0);
      }, 0);

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['typescript-language-server --version']),
        expect.any(Object)
      );
    });

    it('should return false when typescript-language-server is not available', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // Simulate failed command
      setTimeout(() => {
        const onMock = mockProcess.on as jest.Mock;
        const closeCallback = onMock.mock.calls.find((call) => call[0] === 'close')?.[1] as (
          code: number
        ) => void;
        closeCallback?.(1);
      }, 0);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('install', () => {
    it('should install with npm when available', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // First call checks npm availability - succeed
      // Second call installs typescript-language-server - succeed
      (mockProcess.on as jest.Mock).mockImplementation((...args: unknown[]) => {
        const [event, callback] = args as [string, (code: number) => void];
        if (event === 'close') {
          setTimeout(() => {
            callback(0); // Always succeed
          }, 0);
        }
      });

      await provider.install();

      // Verify npm check
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['npm --version']),
        expect.any(Object)
      );

      // Verify install command
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['npm install -g typescript-language-server']),
        expect.any(Object)
      );
    });

    it('should install with yarn when npm is not available', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      let callCount = 0;
      (mockProcess.on as jest.Mock).mockImplementation((...args: unknown[]) => {
        const [event, callback] = args as [string, (code: number) => void];
        if (event === 'close') {
          setTimeout(() => {
            // First call (npm check) fails, rest succeed
            const code = callCount === 0 ? 1 : 0;
            callCount++;
            callback(code);
          }, 0);
        }
      });

      await provider.install();

      // Verify yarn check and install
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['yarn --version']),
        expect.any(Object)
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['yarn global add typescript-language-server']),
        expect.any(Object)
      );
    });

    it('should throw error when no package manager is available', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // All commands fail
      (mockProcess.on as jest.Mock).mockImplementation((...args: unknown[]) => {
        const [event, callback] = args as [string, (code: number) => void];
        if (event === 'close') {
          setTimeout(() => callback(1), 0);
        }
      });

      await expect(provider.install()).rejects.toThrow(
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

    expect(provider).toBeInstanceOf(Provider);
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

    expect(provider).toBeInstanceOf(Provider);
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
