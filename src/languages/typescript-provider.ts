import { exec } from 'child_process';
import { promisify } from 'util';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface LanguageServerProvider {
  language: DetectedLanguage;
  isAvailable(): Promise<boolean>;
  install(options?: { force?: boolean }): Promise<void>;
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

  private async executeCommand(command: string[], timeout = 30000): Promise<string> {
    if (command.length === 0) {
      throw new Error('Command array is empty');
    }

    // Join command and args with proper escaping
    const fullCommand = command
      .map((arg) => {
        // Simple escaping for common cases
        if (arg.includes(' ') && !arg.includes('"')) {
          return `"${arg}"`;
        }
        return arg;
      })
      .join(' ');

    try {
      const { stdout } = await execAsync(fullCommand, {
        cwd: this.language.rootPath || process.cwd(),
        env: process.env,
        timeout,
      });

      return stdout.trim();
    } catch (error) {
      // Type guard for Node.js errors with exec-specific properties
      if (error instanceof Error) {
        // Check for timeout
        if ('code' in error && (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
          throw new Error(`Command timed out after ${timeout}ms: ${command.join(' ')}`);
        }

        // Handle other errors with stderr if available
        let message = error.message;
        if ('stderr' in error) {
          const stderr = (error as Error & { stderr?: string }).stderr;
          if (stderr && typeof stderr === 'string') {
            message = `${message}: ${stderr}`;
          }
        }
        throw new Error(message);
      }

      // Fallback for unknown error types
      throw new Error(`Command failed: ${String(error)}`);
    }
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
