import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { DetectedLanguage } from './detector.js';
import { LanguageServerProvider } from './provider.js';
import { detectContainerSync } from './utils.js';

/**
 * Base class for language server providers with common functionality
 */
export abstract class BaseLanguageServerProvider implements LanguageServerProvider {
  protected readonly isContainer: boolean;

  // Standardized timeout values
  protected static readonly DEFAULT_TIMEOUT = 30000;
  protected static readonly KILL_TIMEOUT = 5000;

  constructor(public readonly language: DetectedLanguage) {
    this.isContainer = detectContainerSync();
  }

  /**
   * Check if the language server is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Install the language server
   */
  abstract install(options?: { force?: boolean }): Promise<void>;

  /**
   * Get the command to start the language server
   */
  getCommand(): string[] {
    if (!this.language.serverCommand || this.language.serverCommand.length === 0) {
      throw new Error(`No server command configured for language ${this.language.id}`);
    }
    return this.language.serverCommand;
  }

  /**
   * Execute a command with proper error handling and timeout
   * This eliminates the duplicated executeCommand across all providers
   */
  protected executeCommand(
    command: string[],
    timeout = BaseLanguageServerProvider.DEFAULT_TIMEOUT
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Validate command array
      if (!command || command.length === 0) {
        reject(new Error('Command array is empty'));
        return;
      }

      const [cmd, ...args] = command;
      if (!cmd) {
        reject(new Error('Command is undefined'));
        return;
      }

      // Use spawn for security - no shell interpretation
      let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
      try {
        child = spawn(cmd, args, {
          cwd: this.language.rootPath || process.cwd(),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false, // Security: prevent command injection
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to spawn ${cmd}: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set timeout after successful spawn
      const timer = setTimeout(() => {
        timedOut = true;
        if (child) {
          child.kill('SIGTERM');
          // Force kill after grace period
          const killTimer = setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, BaseLanguageServerProvider.KILL_TIMEOUT);
          killTimer.unref();
        }
      }, timeout);
      timer.unref();

      if (!child) {
        reject(new Error('Failed to create child process'));
        return;
      }

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeout}ms: ${command.join(' ')}`));
        } else if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMessage = stderr.trim() || `Command failed with code ${code}`;
          reject(new Error(`${cmd} failed: ${errorMessage}`));
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to execute ${cmd}: ${error.message}`));
      });
    });
  }

  /**
   * Detect available package manager
   */
  protected async detectPackageManager(): Promise<string | null> {
    try {
      await this.executeCommand(['npm', '--version']);
      return 'npm';
    } catch {
      try {
        await this.executeCommand(['yarn', '--version']);
        return 'yarn';
      } catch {
        return null;
      }
    }
  }

  /**
   * Helper to check if a command exists using 'which'
   */
  protected async commandExists(command: string): Promise<boolean> {
    try {
      await this.executeCommand(['which', command]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper to check if a command works by running --version
   */
  protected async checkVersion(command: string): Promise<string | null> {
    try {
      const result = await this.executeCommand([command, '--version']);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Standard error messages for common scenarios
   */
  protected getContainerInstallError(serverName: string): Error {
    return new Error(
      `Language server installation in containers is not supported. ` +
        `The ${serverName} should be pre-installed in the container image.`
    );
  }

  protected getForceInstallError(): Error {
    return new Error(
      'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
    );
  }

  protected getManualInstallError(serverName: string, installCommand: string): Error {
    return new Error(
      `Failed to install ${serverName}. ` + `Please install it manually: ${installCommand}`
    );
  }

  protected getNoPackageManagerError(): Error {
    return new Error('No package manager found. Please install npm or yarn.');
  }
}
