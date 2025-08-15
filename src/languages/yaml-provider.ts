import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class YamlLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'yaml-language-server']);
      logger.info('YAML language server found in PATH');
      return true;
    } catch (whichError) {
      logger.debug(
        { whichError },
        'YAML language server not found via which, trying version check'
      );

      try {
        // Try direct version check
        const result = await this.executeCommand(['yaml-language-server', '--version']);
        logger.info({ version: result }, 'YAML language server is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'YAML language server version check failed');

        // Last resort: check if it's installed globally via npm
        try {
          await this.executeCommand(['npm', 'list', '-g', 'yaml-language-server']);
          logger.info('YAML language server found via npm list');
          return true;
        } catch (npmError) {
          logger.error({ npmError }, 'YAML language server not found via any method');
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
          'The yaml-language-server should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing yaml-language-server...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'yaml-language-server']);
        logger.info('YAML language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install YAML language server');
        throw new Error(
          'Failed to install yaml-language-server. ' +
            'Please install it manually: npm install -g yaml-language-server'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'yaml-language-server']);
        logger.info('YAML language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install YAML language server');
        throw new Error(
          'Failed to install yaml-language-server. ' +
            'Please install it manually: yarn global add yaml-language-server'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }
}
