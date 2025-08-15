import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class PythonLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    // Check if pyright-langserver is available
    if (await this.commandExists('pyright-langserver')) {
      logger.info('Pyright language server found in PATH');
      return true;
    }

    // Try direct version check
    const version = await this.checkVersion('pyright-langserver');
    if (version) {
      logger.info({ version }, 'Pyright language server is available');
      return true;
    }

    // Check if it's installed via npm globally
    try {
      await this.executeCommand(['npm', 'list', '-g', 'pyright']);
      logger.info('Pyright found via npm list');
      return true;
    } catch {
      logger.debug('Pyright language server not found');
      return false;
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('pyright');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing Pyright language server...');

    // Check for npm (Pyright requires Node.js)
    try {
      await this.executeCommand(['npm', '--version']);
    } catch {
      throw new Error(
        'npm is not installed. Pyright requires Node.js and npm. ' +
          'Please install Node.js from https://nodejs.org/'
      );
    }

    try {
      // Install Pyright globally via npm
      await this.executeCommand(['npm', 'install', '-g', 'pyright']);
      logger.info('Pyright language server installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install Pyright');
      throw this.getManualInstallError('pyright', 'npm install -g pyright');
    }
  }
}
