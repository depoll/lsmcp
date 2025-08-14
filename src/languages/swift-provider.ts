import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { LanguageServerProvider } from './provider.js';

export class SwiftLanguageServerProvider implements LanguageServerProvider {
  private isContainer: boolean;

  constructor(public readonly language: DetectedLanguage) {
    this.isContainer = this.detectContainer();
  }

  private detectContainer(): boolean {
    return (
      process.env['CONTAINER'] === 'true' ||
      process.env['DOCKER'] === 'true' ||
      // Check for /.dockerenv file (most reliable container indicator)
      existsSync('/.dockerenv')
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'sourcekit-lsp']);
      logger.info('Swift language server (sourcekit-lsp) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'sourcekit-lsp not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['sourcekit-lsp', '--version']);
        logger.info({ version: result }, 'sourcekit-lsp is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'sourcekit-lsp version check failed');

        // Check if Swift is installed and sourcekit-lsp is available
        try {
          await this.executeCommand(['swift', '--version']);
          // Swift is installed, sourcekit-lsp should be available
          logger.info('Swift is installed, sourcekit-lsp should be available');
          return true;
        } catch (swiftError) {
          logger.error({ swiftError }, 'Swift and sourcekit-lsp not found');
          return false;
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'Swift and sourcekit-lsp should be pre-installed in the container image. ' +
          'Consider using a Swift base image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      throw new Error(
        'Swift should already be installed on macOS. ' +
          'If not, install Xcode from the App Store or Xcode Command Line Tools.'
      );
    } else if (platform === 'linux') {
      throw new Error(
        'Swift installation on Linux requires manual setup. ' +
          'Please install Swift from https://swift.org/download/'
      );
    } else {
      throw new Error(
        'Swift is not officially supported on Windows. ' +
          'Consider using WSL or a Docker container with Swift installed.'
      );
    }
  }

  getCommand(): string[] {
    return this.language.serverCommand;
  }

  private executeCommand(command: string[], timeout = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (command.length === 0) {
        reject(new Error('Command array is empty'));
        return;
      }

      const [cmd, ...args] = command;
      if (!cmd) {
        reject(new Error('Command is undefined'));
        return;
      }

      // Use spawn for security - no shell interpretation (container environment)
      let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
      try {
        child = spawn(cmd, args, {
          cwd: this.language.rootPath || process.cwd(),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
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
          }, 5000);
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
          const errorMessage = stderr || `Command failed with code ${code}`;
          reject(new Error(`${cmd} failed: ${errorMessage}`));
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to execute ${cmd}: ${error.message}`));
      });
    });
  }
}
