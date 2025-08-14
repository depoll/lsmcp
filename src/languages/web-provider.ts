import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

/**
 * Base class for web-related language servers (HTML, CSS)
 * These are all provided by the vscode-langservers-extracted package
 */
abstract class WebLanguageServerProvider extends BaseLanguageServerProvider {
  protected abstract serverName: string;
  protected abstract displayName: string;

  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', this.serverName]);
      logger.info(`${this.displayName} language server found in PATH`);
      return true;
    } catch (whichError) {
      logger.debug(
        { whichError },
        `${this.displayName} language server not found via which, trying version check`
      );

      try {
        // Try direct version check
        const result = await this.executeCommand([this.serverName, '--version']);
        logger.info({ version: result }, `${this.displayName} language server is available`);
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, `${this.displayName} language server version check failed`);

        // Last resort: check if it's installed globally via npm
        try {
          await this.executeCommand(['npm', 'list', '-g', 'vscode-langservers-extracted']);
          logger.info(`${this.displayName} language server found via npm list`);
          return true;
        } catch (npmError) {
          logger.error(
            { npmError },
            `${this.displayName} language server not found via any method`
          );
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
          `The ${this.serverName} should be pre-installed in the container image.`
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info(`Installing ${this.displayName} language server...`);

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'vscode-langservers-extracted']);
        logger.info(`${this.displayName} language server installed successfully`);
      } catch (error) {
        logger.error({ error }, `Failed to install ${this.displayName} language server`);
        throw new Error(
          `Failed to install vscode-langservers-extracted. ` +
            'Please install it manually: npm install -g vscode-langservers-extracted'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'vscode-langservers-extracted']);
        logger.info(`${this.displayName} language server installed successfully`);
      } catch (error) {
        logger.error({ error }, `Failed to install ${this.displayName} language server`);
        throw new Error(
          `Failed to install vscode-langservers-extracted. ` +
            'Please install it manually: yarn global add vscode-langservers-extracted'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }
}

export class HtmlLanguageServerProvider extends WebLanguageServerProvider {
  protected serverName = 'vscode-html-language-server';
  protected displayName = 'HTML';
}

export class CssLanguageServerProvider extends WebLanguageServerProvider {
  protected serverName = 'vscode-css-language-server';
  protected displayName = 'CSS';
}
