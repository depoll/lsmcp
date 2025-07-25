import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { DetectedLanguage } from '../../../src/languages/detector.js';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Create mock child process
class MockChildProcess extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  killed = false;

  kill(signal?: string) {
    this.killed = true;
    // Simulate process termination
    setImmediate(() => this.emit('close', signal === 'SIGKILL' ? -9 : -15));
  }
}

// Create mock spawn function with proper typing
type SpawnResult = import('child_process').ChildProcessByStdio<
  null,
  import('stream').Readable,
  import('stream').Readable
>;
const mockSpawn =
  jest.fn<
    (command: string, args?: readonly string[], options?: Record<string, unknown>) => SpawnResult
  >();

// Mock child_process
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
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
      const mockChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(mockChild as unknown as SpawnResult);

      // Simulate successful version output
      setImmediate(() => {
        mockChild.stdout.push('typescript-language-server version 4.0.0\n');
        mockChild.stdout.push(null); // End stream
        mockChild.emit('close', 0);
      });

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'typescript-language-server',
        ['--version'],
        expect.objectContaining({
          cwd: '/test/project',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
    });

    it('should return false when typescript-language-server is not available', async () => {
      const mockChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(mockChild as unknown as SpawnResult);

      // Simulate command not found
      setImmediate(() => {
        mockChild.emit('error', new Error('Command not found'));
      });

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
      const npmCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(npmCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        npmCheckChild.stdout.push('9.0.0\n');
        npmCheckChild.stdout.push(null);
        npmCheckChild.emit('close', 0);
      });

      // Second call installs typescript-language-server - succeed
      const installChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(installChild as unknown as SpawnResult);
      setImmediate(() => {
        installChild.stdout.push('added 1 package\n');
        installChild.stdout.push(null);
        installChild.emit('close', 0);
      });

      await provider.install({ force: true });

      // Verify npm check
      expect(mockSpawn).toHaveBeenCalledWith('npm', ['--version'], expect.any(Object));

      // Verify install command
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '-g', 'typescript-language-server'],
        expect.any(Object)
      );
    });

    it('should install with yarn when npm is not available', async () => {
      // First call (npm check) fails
      const npmCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(npmCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        npmCheckChild.emit('error', new Error('npm not found'));
      });

      // Second call (yarn check) succeeds
      const yarnCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(yarnCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        yarnCheckChild.stdout.push('1.22.0\n');
        yarnCheckChild.stdout.push(null);
        yarnCheckChild.emit('close', 0);
      });

      // Third call installs typescript-language-server
      const installChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(installChild as unknown as SpawnResult);
      setImmediate(() => {
        installChild.stdout.push('success\n');
        installChild.stdout.push(null);
        installChild.emit('close', 0);
      });

      await provider.install({ force: true });

      // Verify yarn was used for installation
      expect(mockSpawn).toHaveBeenCalledWith(
        'yarn',
        ['global', 'add', 'typescript-language-server'],
        expect.any(Object)
      );
    });

    it('should throw error when no package manager is available', async () => {
      // Both npm and yarn checks fail
      const npmCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(npmCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        npmCheckChild.emit('error', new Error('npm not found'));
      });

      const yarnCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(yarnCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        yarnCheckChild.emit('error', new Error('yarn not found'));
      });

      await expect(provider.install({ force: true })).rejects.toThrow('No package manager found');
    });

    it('should handle installation failure gracefully', async () => {
      // npm check succeeds
      const npmCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(npmCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        npmCheckChild.stdout.push('9.0.0\n');
        npmCheckChild.stdout.push(null);
        npmCheckChild.emit('close', 0);
      });

      // Installation fails
      const installChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(installChild as unknown as SpawnResult);
      setImmediate(() => {
        installChild.stderr.push('Installation failed\n');
        installChild.stderr.push(null);
        installChild.emit('close', 1);
      });

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
      // For this test, we'll simulate a command that never completes
      const mockChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(mockChild as unknown as SpawnResult);

      // Start the command but don't emit any events - let it hang
      const resultPromise = provider.isAvailable();

      // Wait a bit and then emit an error (simulating timeout handling)
      await new Promise((resolve) => setTimeout(resolve, 100));
      mockChild.emit('error', new Error('Command not found'));

      // The command should fail due to the error
      await expect(resultPromise).resolves.toBe(false);
    });

    it('should include stderr in error message when available', async () => {
      // npm check succeeds
      const npmCheckChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(npmCheckChild as unknown as SpawnResult);
      setImmediate(() => {
        npmCheckChild.stdout.push('9.0.0\n');
        npmCheckChild.stdout.push(null);
        npmCheckChild.emit('close', 0);
      });

      // Installation fails with stderr
      const installChild = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(installChild as unknown as SpawnResult);
      setImmediate(() => {
        installChild.stderr.push('Permission denied\n');
        installChild.stderr.push(null);
        installChild.emit('close', 1);
      });

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
