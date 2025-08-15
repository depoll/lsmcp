import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import type { DetectedLanguage } from '../../../src/languages/detector.js';

// Create mock child process
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(signal?: string) {
    this.killed = true;
    setImmediate(() => this.emit('close', signal === 'SIGKILL' ? -9 : -15));
  }
}

// Mock spawn function
const mockSpawn = jest.fn();

// Mock modules
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

// Import after mocking
const { BaseLanguageServerProvider } = await import('../../../src/languages/base-provider.js');

// Create a concrete implementation for testing
class TestProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    return await Promise.resolve(true);
  }

  async install(options?: { force?: boolean }): Promise<void> {
    if (!options?.force) {
      throw this.getForceInstallError();
    }
    await Promise.resolve();
  }

  // Expose protected methods for testing
  public testExecuteCommand(command: string[], timeout?: number) {
    return this.executeCommand(command, timeout);
  }

  public testDetectPackageManager() {
    return this.detectPackageManager();
  }

  public testCommandExists(command: string) {
    return this.commandExists(command);
  }

  public testCheckVersion(command: string) {
    return this.checkVersion(command);
  }

  // Expose protected error methods for testing
  public testGetContainerInstallError(serverName: string) {
    return this.getContainerInstallError(serverName);
  }

  public testGetForceInstallError() {
    return this.getForceInstallError();
  }

  public testGetManualInstallError(serverName: string, installCommand: string) {
    return this.getManualInstallError(serverName, installCommand);
  }

  public testGetNoPackageManagerError() {
    return this.getNoPackageManagerError();
  }
}

describe('BaseLanguageServerProvider', () => {
  let provider: TestProvider;
  let language: DetectedLanguage;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    // Reset environment
    delete process.env['CONTAINER'];
    delete process.env['DOCKER'];

    language = {
      id: 'test',
      name: 'Test Language',
      fileExtensions: ['.test'],
      serverCommand: ['test-server', '--stdio'],
      rootPath: '/test/project',
    };

    provider = new TestProvider(language);

    // Default mock process setup
    mockProcess = new MockChildProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should detect container environment via CONTAINER env var', () => {
      process.env['CONTAINER'] = 'true';
      const containerProvider = new TestProvider(language);
      expect(containerProvider).toBeDefined();
    });

    it('should detect container environment via DOCKER env var', () => {
      process.env['DOCKER'] = 'true';
      const containerProvider = new TestProvider(language);
      expect(containerProvider).toBeDefined();
    });
  });

  describe('getCommand', () => {
    it('should return the server command', () => {
      const command = provider.getCommand();
      expect(command).toEqual(['test-server', '--stdio']);
    });

    it('should throw error if no server command configured', () => {
      const invalidLanguage = { ...language, serverCommand: [] };
      const invalidProvider = new TestProvider(invalidLanguage);
      expect(() => invalidProvider.getCommand()).toThrow(
        'No server command configured for language test'
      );
    });

    it('should throw error if server command is undefined', () => {
      const invalidLanguage = { ...language, serverCommand: undefined as unknown as string[] };
      const invalidProvider = new TestProvider(invalidLanguage);
      expect(() => invalidProvider.getCommand()).toThrow(
        'No server command configured for language test'
      );
    });
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const promise = provider.testExecuteCommand(['echo', 'test']);

      // Simulate successful command output
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('test output\n'));
        mockProcess.emit('close', 0);
      });

      const result = await promise;
      expect(result).toBe('test output');
      expect(mockSpawn).toHaveBeenCalledWith('echo', ['test'], {
        cwd: '/test/project',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle command failure', async () => {
      const promise = provider.testExecuteCommand(['false']);

      // Simulate command failure
      setImmediate(() => {
        mockProcess.stderr.emit('data', Buffer.from('error message\n'));
        mockProcess.emit('close', 1);
      });

      await expect(promise).rejects.toThrow('false failed: error message');
    });

    it('should handle command timeout', async () => {
      jest.useFakeTimers();

      const promise = provider.testExecuteCommand(['sleep', '10'], 100);

      // Advance timers to trigger timeout
      jest.advanceTimersByTime(100);

      // Kill the mock process to trigger the close event
      mockProcess.kill('SIGTERM');

      await expect(promise).rejects.toThrow('Command timed out after 100ms: sleep 10');

      jest.useRealTimers();
    }, 10000);

    it('should reject empty command array', async () => {
      await expect(provider.testExecuteCommand([])).rejects.toThrow('Command array is empty');
    });

    it('should handle spawn error', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      await expect(provider.testExecuteCommand(['test'])).rejects.toThrow(
        'Failed to spawn test: spawn failed'
      );
    });

    it('should handle process error event', async () => {
      const promise = provider.testExecuteCommand(['test']);

      // Emit error event
      mockProcess.emit('error', new Error('Process error'));

      await expect(promise).rejects.toThrow('Failed to execute test: Process error');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect npm', async () => {
      // Mock npm version check success
      mockSpawn.mockImplementationOnce(() => {
        const proc = new MockChildProcess();
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('9.0.0\n'));
          proc.emit('close', 0);
        });
        return proc;
      });

      const result = await provider.testDetectPackageManager();
      expect(result).toBe('npm');
    }, 10000);

    it('should detect yarn when npm is not available', async () => {
      // Mock npm failure
      mockSpawn.mockImplementationOnce(() => {
        const proc = new MockChildProcess();
        setImmediate(() => proc.emit('close', 1));
        return proc;
      });

      // Mock yarn success
      mockSpawn.mockImplementationOnce(() => {
        const proc = new MockChildProcess();
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('1.22.0\n'));
          proc.emit('close', 0);
        });
        return proc;
      });

      const result = await provider.testDetectPackageManager();
      expect(result).toBe('yarn');
    }, 10000);

    it('should return null when no package manager found', async () => {
      // Mock both failures
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess();
        setImmediate(() => proc.emit('close', 1));
        return proc;
      });

      const result = await provider.testDetectPackageManager();
      expect(result).toBeNull();
    }, 10000);
  });

  describe('commandExists', () => {
    it('should return true when command exists', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(proc);
      setImmediate(() => proc.emit('close', 0));

      const result = await provider.testCommandExists('test-cmd');
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('which', ['test-cmd'], expect.any(Object));
    }, 10000);

    it('should return false when command does not exist', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(proc);
      setImmediate(() => proc.emit('close', 1));

      const result = await provider.testCommandExists('missing-cmd');
      expect(result).toBe(false);
    }, 10000);
  });

  describe('checkVersion', () => {
    it('should return version when command supports --version', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(proc);
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('v1.0.0\n'));
        proc.emit('close', 0);
      });

      const result = await provider.testCheckVersion('test-cmd');
      expect(result).toBe('v1.0.0');
      expect(mockSpawn).toHaveBeenCalledWith('test-cmd', ['--version'], expect.any(Object));
    }, 10000);

    it('should return null when version check fails', async () => {
      const proc = new MockChildProcess();
      mockSpawn.mockReturnValueOnce(proc);
      setImmediate(() => proc.emit('close', 1));

      const result = await provider.testCheckVersion('test-cmd');
      expect(result).toBeNull();
    }, 10000);
  });

  describe('error helpers', () => {
    it('should generate container install error', () => {
      const error = provider.testGetContainerInstallError('test-server');
      expect(error.message).toContain(
        'Language server installation in containers is not supported'
      );
      expect(error.message).toContain('test-server');
    });

    it('should generate force install error', () => {
      const error = provider.testGetForceInstallError();
      expect(error.message).toContain('Auto-installation requires explicit user consent');
      expect(error.message).toContain('{ force: true }');
    });

    it('should generate manual install error', () => {
      const error = provider.testGetManualInstallError('test-server', 'npm install -g test-server');
      expect(error.message).toContain('Failed to install test-server');
      expect(error.message).toContain('npm install -g test-server');
    });

    it('should generate no package manager error', () => {
      const error = provider.testGetNoPackageManagerError();
      expect(error.message).toContain('No package manager found');
      expect(error.message).toContain('npm or yarn');
    });
  });
});
