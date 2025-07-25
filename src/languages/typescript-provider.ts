import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';

export interface LanguageServerProvider {
  language: DetectedLanguage;
  isAvailable(): Promise<boolean>;
  install(options?: { force?: boolean }): Promise<void>;
  getCommand(): string[];
}

export class TypeScriptLanguageServerProvider implements LanguageServerProvider {
  constructor(public readonly language: DetectedLanguage) {}

  async isAvailable(): Promise<boolean> {
    // In CI environments, skip the availability check if the binary is in PATH
    if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
      try {
        // Just check if the command exists in PATH using 'which' or 'where'
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        await this.executeCommand([whichCmd, 'typescript-language-server']);
        logger.info('TypeScript language server found in PATH (CI environment)');
        return true;
      } catch (error) {
        logger.debug({ error }, 'TypeScript language server not in PATH');
        return false;
      }
    }

    try {
      // Check if typescript-language-server is available
      const result = await this.executeCommand(['typescript-language-server', '--version']);
      logger.info({ version: result }, 'TypeScript language server is available');
      return true;
    } catch (error) {
      logger.debug({ error }, 'TypeScript language server not found');
      return false;
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
    }

    logger.info('Installing typescript-language-server...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'typescript-language-server']);
        logger.info('TypeScript language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install TypeScript language server');
        throw new Error(
          'Failed to install typescript-language-server. ' +
            'Please install it manually: npm install -g typescript-language-server'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'typescript-language-server']);
        logger.info('TypeScript language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install TypeScript language server');
        throw new Error(
          'Failed to install typescript-language-server. ' +
            'Please install it manually: yarn global add typescript-language-server'
        );
      }
    } else {
      throw new Error('No package manager found. Please install npm or yarn.');
    }
  }

  getCommand(): string[] {
    return this.language.serverCommand;
  }

  private async detectPackageManager(): Promise<string | null> {
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

      // Use spawn for security - no shell interpretation
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(cmd, args, {
          cwd: this.language.rootPath || process.cwd(),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
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

      // Set timeout
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after grace period
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

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

export function createLanguageServerProvider(
  language: DetectedLanguage
): LanguageServerProvider | null {
  switch (language.id) {
    case 'typescript':
    case 'javascript':
      return new TypeScriptLanguageServerProvider(language);
    default:
      return null;
  }
}
