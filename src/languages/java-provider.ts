import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { LanguageServerProvider } from './provider.js';
import { glob } from 'glob';
import { detectContainerSync } from './utils.js';

export class JavaLanguageServerProvider implements LanguageServerProvider {
  private isContainer: boolean;

  constructor(public readonly language: DetectedLanguage) {
    this.isContainer = detectContainerSync();
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Java is available first
      await this.executeCommand(['java', '-version']);

      // Check Eclipse JDT.LS installation using async operations
      const jdtlsPath = '/opt/eclipse.jdt.ls';

      try {
        await access(jdtlsPath, constants.F_OK);
      } catch {
        logger.warn('Eclipse JDT.LS not found at expected location');
        return false;
      }

      // Find the launcher jar using async glob
      const launcherJars = await glob(
        join(jdtlsPath, 'plugins/org.eclipse.equinox.launcher_*.jar')
      );

      if (launcherJars.length === 0) {
        logger.warn('Eclipse JDT.LS launcher jar not found');
        return false;
      }

      logger.info('Java language server (Eclipse JDT.LS) is available');
      return true;
    } catch (error) {
      logger.error({ error }, 'Java language server not available');
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The Eclipse JDT.LS should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    throw new Error(
      'Java language server installation is complex and requires manual setup. ' +
        'Please install Eclipse JDT.LS manually from https://github.com/eclipse/eclipse.jdt.ls'
    );
  }

  getCommand(): string[] {
    // Override the default command with the full Java command
    // The launcher jar path will be resolved by the LSP manager
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
