import { access, constants } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';
import { glob } from 'glob';

export class JavaLanguageServerProvider extends BaseLanguageServerProvider {
  private cachedLauncherJar: string | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Java is available first
      await this.executeCommand(['java', '-version']);

      // Check Eclipse JDT.LS installation using async operations
      const jdtlsPath = '/opt/eclipse.jdt.ls';

      try {
        await access(jdtlsPath, constants.F_OK);
      } catch {
        logger.warn('Eclipse JDT.LS not found at expected location');
        return false;
      }

      // Use cached launcher jar if available
      if (this.cachedLauncherJar) {
        try {
          await access(this.cachedLauncherJar, constants.F_OK);
          return true;
        } catch {
          // Cache is stale, clear it
          this.cachedLauncherJar = null;
        }
      }

      // Find the launcher jar using async glob
      const launcherJars = await glob(
        join(jdtlsPath, 'plugins/org.eclipse.equinox.launcher_*.jar')
      );

      if (launcherJars.length === 0) {
        logger.warn('Eclipse JDT.LS launcher jar not found');
        return false;
      }

      // Cache the first launcher jar found (we know it exists due to length check)
      this.cachedLauncherJar = launcherJars[0] ?? null;

      logger.info('Java language server (Eclipse JDT.LS) is available');
      return true;
    } catch (error) {
      logger.error({ error }, 'Java language server not available');
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('Eclipse JDT.LS');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    throw new Error(
      'Java language server installation is complex and requires manual setup. ' +
        'Please install Eclipse JDT.LS manually from https://github.com/eclipse/eclipse.jdt.ls'
    );
  }

  getCommand(): string[] {
    // Override the default command with the full Java command
    // The launcher jar path will be resolved by the LSP manager
    return this.language.serverCommand;
  }
}
