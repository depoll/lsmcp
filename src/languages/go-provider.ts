import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class GoLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'gopls']);
      logger.info('Go language server (gopls) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'gopls not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['gopls', 'version']);
        logger.info({ version: result }, 'gopls is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'gopls version check failed');

        // Check if gopls is in GOPATH/bin
        try {
          const gopath = process.env['GOPATH'] || `${process.env['HOME']}/go`;
          await this.executeCommand([`${gopath}/bin/gopls`, 'version']);
          logger.info('gopls found in GOPATH');
          return true;
        } catch (gopathError) {
          logger.error({ gopathError }, 'gopls not found in GOPATH');
          return false;
        }
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('gopls');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing gopls...');

    // Check if Go is installed
    try {
      await this.executeCommand(['go', 'version']);
    } catch {
      throw new Error('Go is not installed. Please install Go first from https://golang.org/dl/');
    }

    try {
      // Install gopls using go install
      await this.executeCommand(['go', 'install', 'golang.org/x/tools/gopls@latest']);
      logger.info('gopls installed successfully');

      // Ensure GOPATH/bin is in PATH
      const gopath = process.env['GOPATH'] || `${process.env['HOME']}/go`;
      logger.info(`gopls installed to ${gopath}/bin. Make sure this directory is in your PATH.`);
    } catch (error) {
      logger.error({ error }, 'Failed to install gopls');
      throw this.getManualInstallError('gopls', 'go install golang.org/x/tools/gopls@latest');
    }
  }

  getCommand(): string[] {
    // Override the default command to include 'serve' argument
    // gopls needs to be started with 'serve' for stdio mode
    const baseCommand = this.language.serverCommand;
    if (baseCommand[0] === 'gopls' && !baseCommand.includes('serve')) {
      return ['gopls', 'serve'];
    }
    return baseCommand;
  }
}
