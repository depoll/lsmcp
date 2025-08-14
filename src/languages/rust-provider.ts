import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { LanguageServerProvider } from './provider.js';

export class RustLanguageServerProvider implements LanguageServerProvider {
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
      await this.executeCommand(['which', 'rust-analyzer']);
      logger.info('Rust analyzer found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'Rust analyzer not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['rust-analyzer', '--version']);
        logger.info({ version: result }, 'Rust analyzer is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'Rust analyzer version check failed');
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
          'The rust-analyzer should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    logger.info('Installing rust-analyzer...');

    try {
      // Download and install rust-analyzer
      const platform = process.platform;
      const arch = process.arch;

      let downloadUrl = '';
      if (platform === 'linux' && arch === 'x64') {
        downloadUrl =
          'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz';
      } else if (platform === 'darwin' && arch === 'x64') {
        downloadUrl =
          'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-apple-darwin.gz';
      } else if (platform === 'darwin' && arch === 'arm64') {
        downloadUrl =
          'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-apple-darwin.gz';
      } else if (platform === 'win32' && arch === 'x64') {
        downloadUrl =
          'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-pc-windows-msvc.gz';
      } else {
        throw new Error(`Unsupported platform: ${platform} ${arch}`);
      }

      // Download and extract
      await this.executeCommand([
        'sh',
        '-c',
        `curl -L "${downloadUrl}" | gunzip -c - > /usr/local/bin/rust-analyzer && chmod +x /usr/local/bin/rust-analyzer`,
      ]);

      logger.info('Rust analyzer installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install rust-analyzer');
      throw new Error(
        'Failed to install rust-analyzer. ' +
          'Please install it manually from https://rust-analyzer.github.io/manual.html#installation'
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
