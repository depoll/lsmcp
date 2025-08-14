import { createWriteStream, chmodSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import https from 'https';

import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class RustLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    // Try simple which check first
    if (await this.commandExists('rust-analyzer')) {
      logger.info('Rust analyzer found in PATH');
      return true;
    }

    // Try direct version check
    const version = await this.checkVersion('rust-analyzer');
    if (version) {
      logger.info({ version }, 'Rust analyzer is available');
      return true;
    }

    logger.debug('Rust analyzer not found');
    return false;
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('rust-analyzer');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing rust-analyzer...');

    try {
      // Determine platform-specific download URL
      const downloadUrl = this.getDownloadUrl();

      // Download and install using Node.js HTTP client (secure approach)
      await this.downloadAndInstall(downloadUrl);

      logger.info('Rust analyzer installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install rust-analyzer');
      throw this.getManualInstallError(
        'rust-analyzer',
        'https://rust-analyzer.github.io/manual.html#installation'
      );
    }
  }

  private getDownloadUrl(): string {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'linux' && arch === 'x64') {
      return 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz';
    } else if (platform === 'darwin' && arch === 'x64') {
      return 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-apple-darwin.gz';
    } else if (platform === 'darwin' && arch === 'arm64') {
      return 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-apple-darwin.gz';
    } else if (platform === 'win32' && arch === 'x64') {
      return 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-pc-windows-msvc.gz';
    } else {
      throw new Error(`Unsupported platform: ${platform} ${arch}`);
    }
  }

  private async downloadAndInstall(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Follow redirects to get the actual download URL
      https
        .get(url, { headers: { 'User-Agent': 'lsmcp' } }, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Handle redirect
            const redirectUrl = response.headers.location;
            if (!redirectUrl) {
              reject(new Error('Redirect URL not found'));
              return;
            }
            this.downloadAndInstall(redirectUrl).then(resolve).catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
            return;
          }

          const targetPath = '/usr/local/bin/rust-analyzer';
          const gunzip = createGunzip();
          const writeStream = createWriteStream(targetPath);

          pipeline(response, gunzip, writeStream)
            .then(() => {
              // Make the file executable
              try {
                chmodSync(targetPath, 0o755);
                resolve();
              } catch (error) {
                reject(new Error(`Failed to make rust-analyzer executable: ${String(error)}`));
              }
            })
            .catch((error) => {
              reject(new Error(`Failed to download and extract rust-analyzer: ${String(error)}`));
            });
        })
        .on('error', (error) => {
          reject(new Error(`Failed to download rust-analyzer: ${error.message}`));
        });
    });
  }
}
