import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class BashLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'bash-language-server']);
      logger.info('Bash language server found in PATH');
      return true;
    } catch (whichError) {
      logger.debug(
        { whichError },
        'Bash language server not found via which, trying version check'
      );

      try {
        // Try direct version check
        const result = await this.executeCommand(['bash-language-server', '--version']);
        logger.info({ version: result }, 'Bash language server is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'Bash language server version check failed');

        // Last resort: check if it's installed globally via npm
        try {
          await this.executeCommand(['npm', 'list', '-g', 'bash-language-server']);
          logger.info('Bash language server found via npm list');
          return true;
        } catch (npmError) {
          logger.error({ npmError }, 'Bash language server not found via any method');
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
          'The bash-language-server should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing bash-language-server...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'bash-language-server']);
        logger.info('Bash language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install Bash language server');
        throw new Error(
          'Failed to install bash-language-server. ' +
            'Please install it manually: npm install -g bash-language-server'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'bash-language-server']);
        logger.info('Bash language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install Bash language server');
        throw new Error(
          'Failed to install bash-language-server. ' +
            'Please install it manually: yarn global add bash-language-server'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }

  getCommand(): string[] {
    // bash-language-server needs 'start' argument
    const baseCommand = this.language.serverCommand;
    if (baseCommand[0] === 'bash-language-server' && !baseCommand.includes('start')) {
      return ['bash-language-server', 'start'];
    }
    return baseCommand;
  }
}
