import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class CppLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'clangd']);
      logger.info('C/C++ language server (clangd) found in PATH');
      return true;
    } catch (whichError) {
      logger.debug({ whichError }, 'clangd not found via which, trying version check');

      try {
        // Try direct version check
        const result = await this.executeCommand(['clangd', '--version']);
        logger.info({ version: result }, 'clangd is available');
        return true;
      } catch (versionError) {
        logger.warn({ versionError }, 'clangd version check failed');
        return false;
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The clangd should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing clangd...');

    const platform = process.platform;

    try {
      if (platform === 'linux') {
        // Try apt-get first (Debian/Ubuntu)
        try {
          await this.executeCommand(['sudo', 'apt-get', 'update']);
          await this.executeCommand(['sudo', 'apt-get', 'install', '-y', 'clangd']);
          logger.info('clangd installed successfully via apt-get');
        } catch {
          // Try yum/dnf (RedHat/Fedora)
          try {
            await this.executeCommand(['sudo', 'yum', 'install', '-y', 'clang-tools-extra']);
            logger.info('clangd installed successfully via yum');
          } catch {
            throw new Error('Failed to install clangd via apt-get or yum');
          }
        }
      } else if (platform === 'darwin') {
        // macOS - try brew
        try {
          await this.executeCommand(['brew', 'install', 'llvm']);
          logger.info(
            'clangd installed successfully via brew. You may need to add LLVM to your PATH.'
          );
        } catch {
          throw new Error('Failed to install clangd via brew. Please install Homebrew first.');
        }
      } else if (platform === 'win32') {
        throw new Error(
          'Automatic installation on Windows is not supported. ' +
            'Please install clangd manually from https://clangd.llvm.org/installation.html'
        );
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to install clangd');
      throw new Error(
        'Failed to install clangd. ' +
          'Please install it manually from https://clangd.llvm.org/installation.html'
      );
    }
  }
}
