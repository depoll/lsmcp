import { spawn } from 'child_process';
import { platform } from 'os';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';

export interface LanguageServerProvider {
  language: DetectedLanguage;
  isAvailable(): Promise<boolean>;
  install(): Promise<void>;
  getCommand(): string[];
}

export class TypeScriptLanguageServerProvider implements LanguageServerProvider {
  constructor(public readonly language: DetectedLanguage) {}

  async isAvailable(): Promise<boolean> {
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

  async install(): Promise<void> {
    logger.info('Installing typescript-language-server...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    try {
      if (packageManager === 'npm') {
        await this.executeCommand(['npm', 'install', '-g', 'typescript-language-server']);
      } else if (packageManager === 'yarn') {
        await this.executeCommand(['yarn', 'global', 'add', 'typescript-language-server']);
      } else {
        throw new Error('No package manager found. Please install npm or yarn.');
      }

      logger.info('TypeScript language server installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install TypeScript language server');
      throw new Error(
        'Failed to install typescript-language-server. ' +
          'Please install it manually: npm install -g typescript-language-server'
      );
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

  private executeCommand(command: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWindows = platform() === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArg = isWindows ? '/c' : '-c';

      const child = spawn(shell, [shellArg, command.join(' ')], {
        cwd: this.language.rootPath || process.cwd(),
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
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
