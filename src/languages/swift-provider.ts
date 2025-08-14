import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class SwiftLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'sourcekit-lsp']);
      logger.info('Swift language server (sourcekit-lsp) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'sourcekit-lsp not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['sourcekit-lsp', '--version']);
        logger.info({ version: result }, 'sourcekit-lsp is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'sourcekit-lsp version check failed');

        // Check if Swift is installed and sourcekit-lsp is available
        try {
          await this.executeCommand(['swift', '--version']);
          // Swift is installed, sourcekit-lsp should be available
          logger.info('Swift is installed, sourcekit-lsp should be available');
          return true;
        } catch (swiftError) {
          logger.error({ swiftError }, 'Swift and sourcekit-lsp not found');
          return false;
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'Swift and sourcekit-lsp should be pre-installed in the container image. ' +
          'Consider using a Swift base image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      throw new Error(
        'Swift should already be installed on macOS. ' +
          'If not, install Xcode from the App Store or Xcode Command Line Tools.'
      );
    } else if (platform === 'linux') {
      throw new Error(
        'Swift installation on Linux requires manual setup. ' +
          'Please install Swift from https://swift.org/download/'
      );
    } else {
      throw new Error(
        'Swift is not officially supported on Windows. ' +
          'Consider using WSL or a Docker container with Swift installed.'
      );
    }
  }
}
