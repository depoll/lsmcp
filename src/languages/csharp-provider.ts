import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class CSharpLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'csharp-ls']);
      logger.info('C# language server (csharp-ls) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'csharp-ls not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['csharp-ls', '--version']);
        logger.info({ version: result }, 'csharp-ls is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'csharp-ls version check failed');

        // Check if csharp-ls is in .dotnet/tools
        try {
          const home = process.env['HOME'] || '/root';
          await this.executeCommand([`${home}/.dotnet/tools/csharp-ls`, '--version']);
          logger.info('csharp-ls found in .dotnet/tools');
          return true;
        } catch (dotnetError) {
          logger.error({ dotnetError }, 'csharp-ls not found in .dotnet/tools');
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
          'The csharp-ls should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing csharp-ls...');

    // Check if dotnet is installed
    try {
      await this.executeCommand(['dotnet', '--version']);
    } catch {
      throw new Error(
        '.NET SDK is not installed. Please install .NET SDK first from https://dotnet.microsoft.com/download'
      );
    }

    try {
      // Install csharp-ls using dotnet tool
      await this.executeCommand(['dotnet', 'tool', 'install', '--global', 'csharp-ls']);
      logger.info('csharp-ls installed successfully');

      // Ensure .dotnet/tools is in PATH
      const home = process.env['HOME'] || '/root';
      logger.info(
        `csharp-ls installed to ${home}/.dotnet/tools. Make sure this directory is in your PATH.`
      );
    } catch (error) {
      // Check if already installed
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already installed')) {
        logger.info('csharp-ls is already installed');
        return;
      }

      logger.error({ error }, 'Failed to install csharp-ls');
      throw new Error(
        'Failed to install csharp-ls. ' +
          'Please install it manually: dotnet tool install --global csharp-ls'
      );
    }
  }
}
