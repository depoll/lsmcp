import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class KotlinLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    try {
      // Try simple which check (Unix-style since we're container-first)
      await this.executeCommand(['which', 'kotlin-language-server']);
      logger.info('Kotlin language server found in PATH');
      return true;
    } catch (whichError) {
      logger.debug(
        { whichError },
        'Kotlin language server not found via which, checking alternative locations'
      );

      // Check if it's installed in /opt
      const optPath = '/opt/kotlin-language-server/bin/kotlin-language-server';
      if (existsSync(optPath)) {
        logger.info('Kotlin language server found at /opt/kotlin-language-server');
        return true;
      }

      logger.error('Kotlin language server not found');
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The kotlin-language-server should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    throw new Error(
      'Kotlin language server installation requires manual setup. ' +
        'Please download and install from https://github.com/fwcd/kotlin-language-server'
    );
  }

  getCommand(): string[] {
    // Check if the server is in a custom location
    const optPath = '/opt/kotlin-language-server/bin/kotlin-language-server';
    if (existsSync(optPath)) {
      return [optPath];
    }
    return this.language.serverCommand;
  }
}
