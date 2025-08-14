import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class JsonLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'vscode-json-language-server']);
      logger.info('JSON language server found in PATH');
      return true;
    } catch (whichError) {
      logger.debug(
        { whichError },
        'JSON language server not found via which, trying version check'
      );

      try {
        // Try direct version check
        const result = await this.executeCommand(['vscode-json-language-server', '--version']);
        logger.info({ version: result }, 'JSON language server is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'JSON language server version check failed');

        // Last resort: check if it's installed globally via npm
        try {
          await this.executeCommand(['npm', 'list', '-g', 'vscode-langservers-extracted']);
          logger.info('JSON language server found via npm list');
          return true;
        } catch (npmError) {
          logger.error({ npmError }, 'JSON language server not found via any method');
          return false;
        }
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('vscode-json-language-server');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing vscode-langservers-extracted (includes JSON language server)...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'vscode-langservers-extracted']);
        logger.info('JSON language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install JSON language server');
        throw this.getManualInstallError(
          'vscode-langservers-extracted',
          'npm install -g vscode-langservers-extracted'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'vscode-langservers-extracted']);
        logger.info('JSON language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install JSON language server');
        throw this.getManualInstallError(
          'vscode-langservers-extracted',
          'yarn global add vscode-langservers-extracted'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }

  getCommand(): string[] {
    // vscode-json-language-server needs '--stdio' argument
    const baseCommand = this.language.serverCommand;
    if (baseCommand[0] === 'vscode-json-language-server' && !baseCommand.includes('--stdio')) {
      return ['vscode-json-language-server', '--stdio'];
    }
    return baseCommand;
  }
}
