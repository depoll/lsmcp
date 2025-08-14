import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class CSharpLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    // Try simple which check for OmniSharp
    if (await this.commandExists('omnisharp')) {
      logger.info('OmniSharp C# language server found in PATH');
      return true;
    }

    // Check if it's in /opt/omnisharp (container installation)
    try {
      await this.executeCommand(['/opt/omnisharp/OmniSharp', '--version']);
      logger.info('OmniSharp found at /opt/omnisharp');
      return true;
    } catch {
      logger.debug('OmniSharp not found');
      return false;
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('OmniSharp');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing OmniSharp...');

    // OmniSharp installation is complex and platform-specific
    // Using Promise.reject to satisfy async requirement
    await Promise.reject(
      new Error(
        'OmniSharp installation is complex and requires manual setup. ' +
          'Please install OmniSharp manually from https://github.com/OmniSharp/omnisharp-roslyn'
      )
    );
  }

  getCommand(): string[] {
    // Check if OmniSharp is in /opt/omnisharp (container installation)
    if (this.isContainer) {
      return ['/opt/omnisharp/OmniSharp', '-lsp'];
    }
    return this.language.serverCommand;
  }
}
