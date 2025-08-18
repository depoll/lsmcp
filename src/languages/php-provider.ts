import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class PhpLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'intelephense']);
      logger.info('PHP language server (Intelephense) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'Intelephense not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['intelephense', '--version']);
        logger.info({ version: result }, 'Intelephense is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'Intelephense version check failed');

        // Last resort: check if it's installed globally via npm
        try {
          await this.executeCommand(['npm', 'list', '-g', 'intelephense']);
          logger.info('Intelephense found via npm list');
          return true;
        } catch (npmError) {
          logger.error({ npmError }, 'Intelephense not found via any method');
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
          'The intelephense should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing Intelephense...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'intelephense']);
        logger.info('Intelephense installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install Intelephense');
        throw new Error(
          'Failed to install intelephense. ' +
            'Please install it manually: npm install -g intelephense'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'intelephense']);
        logger.info('Intelephense installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install Intelephense');
        throw new Error(
          'Failed to install intelephense. ' +
            'Please install it manually: yarn global add intelephense'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }
}
