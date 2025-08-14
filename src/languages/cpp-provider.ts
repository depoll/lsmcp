import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { LanguageServerProvider } from './provider.js';

export class CppLanguageServerProvider implements LanguageServerProvider {
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
      await this.executeCommand(['which', 'clangd']);
      logger.info('C/C++ language server (clangd) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'clangd not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['clangd', '--version']);
        logger.info({ version: result }, 'clangd is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'clangd version check failed');
        return false;
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The clangd should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    logger.info('Installing clangd...');

    const platform = process.platform;

    try {
      if (platform === 'linux') {
        // Try apt-get first (Debian/Ubuntu)
        try {
          await this.executeCommand(['sudo', 'apt-get', 'update']);
          await this.executeCommand(['sudo', 'apt-get', 'install', '-y', 'clangd']);
          logger.info('clangd installed successfully via apt-get');
        } catch {
          // Try yum/dnf (RedHat/Fedora)
          try {
            await this.executeCommand(['sudo', 'yum', 'install', '-y', 'clang-tools-extra']);
            logger.info('clangd installed successfully via yum');
          } catch {
            throw new Error('Failed to install clangd via apt-get or yum');
          }
        }
      } else if (platform === 'darwin') {
        // macOS - try brew
        try {
          await this.executeCommand(['brew', 'install', 'llvm']);
          logger.info(
            'clangd installed successfully via brew. You may need to add LLVM to your PATH.'
          );
        } catch {
          throw new Error('Failed to install clangd via brew. Please install Homebrew first.');
        }
      } else if (platform === 'win32') {
        throw new Error(
          'Automatic installation on Windows is not supported. ' +
            'Please install clangd manually from https://clangd.llvm.org/installation.html'
        );
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to install clangd');
      throw new Error(
        'Failed to install clangd. ' +
          'Please install it manually from https://clangd.llvm.org/installation.html'
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
