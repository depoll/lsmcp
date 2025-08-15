import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class RubyLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'solargraph']);
      logger.info('Ruby language server (Solargraph) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'Solargraph not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['solargraph', '--version']);
        logger.info({ version: result }, 'Solargraph is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'Solargraph version check failed');

        // Check if it's installed via gem
        try {
          await this.executeCommand(['gem', 'list', '-i', 'solargraph']);
          logger.info('Solargraph found via gem list');
          return true;
        } catch (gemError) {
          logger.error({ gemError }, 'Solargraph not found via any method');
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
          'The solargraph should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing Solargraph...');

    // Check if Ruby is installed
    try {
      await this.executeCommand(['ruby', '--version']);
    } catch {
      throw new Error(
        'Ruby is not installed. Please install Ruby first from https://www.ruby-lang.org/'
      );
    }

    try {
      // Install solargraph using gem
      await this.executeCommand(['gem', 'install', 'solargraph']);
      logger.info('Solargraph installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install Solargraph');
      throw new Error(
        'Failed to install solargraph. ' + 'Please install it manually: gem install solargraph'
      );
    }
  }
}
