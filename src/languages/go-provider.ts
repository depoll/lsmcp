import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { LanguageServerProvider } from './provider.js';

export class GoLanguageServerProvider implements LanguageServerProvider {
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
      await this.executeCommand(['which', 'gopls']);
      logger.info('Go language server (gopls) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'gopls not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['gopls', 'version']);
        logger.info({ version: result }, 'gopls is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'gopls version check failed');

        // Check if gopls is in GOPATH/bin
        try {
          const gopath = process.env['GOPATH'] || `${process.env['HOME']}/go`;
          await this.executeCommand([`${gopath}/bin/gopls`, 'version']);
          logger.info('gopls found in GOPATH');
          return true;
        } catch (gopathError) {
          logger.error({ gopathError }, 'gopls not found in GOPATH');
          return false;
        }
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The gopls should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    logger.info('Installing gopls...');

    // Check if Go is installed
    try {
      await this.executeCommand(['go', 'version']);
    } catch {
      throw new Error('Go is not installed. Please install Go first from https://golang.org/dl/');
    }

    try {
      // Install gopls using go install
      await this.executeCommand(['go', 'install', 'golang.org/x/tools/gopls@latest']);
      logger.info('gopls installed successfully');

      // Ensure GOPATH/bin is in PATH
      const gopath = process.env['GOPATH'] || `${process.env['HOME']}/go`;
      logger.info(`gopls installed to ${gopath}/bin. Make sure this directory is in your PATH.`);
    } catch (error) {
      logger.error({ error }, 'Failed to install gopls');
      throw new Error(
        'Failed to install gopls. ' +
          'Please install it manually: go install golang.org/x/tools/gopls@latest'
      );
    }
  }

  getCommand(): string[] {
    // Override the default command to include 'serve' argument
    // gopls needs to be started with 'serve' for stdio mode
    const baseCommand = this.language.serverCommand;
    if (baseCommand[0] === 'gopls' && !baseCommand.includes('serve')) {
      return ['gopls', 'serve'];
    }
    return baseCommand;
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
