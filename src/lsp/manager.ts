import { LSPClientV2 as LSPClient } from './client-v2.js';
import { LanguageServerConfig, HealthStatus, ConnectionPoolOptions } from '../types/lsp.js';
import { LanguageDetector, createLanguageServerProvider } from '../languages/index.js';
import pino from 'pino';

const DEFAULT_SERVERS: Record<string, LanguageServerConfig> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npm: 'typescript-language-server',
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npm: 'typescript-language-server',
  },
  python: {
    command: 'pylsp',
    args: [],
    pip: 'python-lsp-server',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
  },
  go: {
    command: 'gopls',
    args: [],
  },
  java: {
    command: 'jdtls',
    args: [],
  },
  cpp: {
    command: 'clangd',
    args: [],
  },
  c: {
    command: 'clangd',
    args: [],
  },
  ruby: {
    command: 'solargraph',
    args: ['stdio'],
  },
  php: {
    command: 'intelephense',
    args: ['--stdio'],
    npm: 'intelephense',
  },
};

interface ConnectionInfo {
  client: LSPClient;
  health: HealthStatus;
  lastUsed: Date;
  healthCheckInterval?: NodeJS.Timeout;
}

export class ConnectionPool {
  private connections = new Map<string, ConnectionInfo>();
  private languageServers = new Map<string, LanguageServerConfig>();
  private logger = pino({ level: 'info' });
  private options: Required<ConnectionPoolOptions>;
  private languageDetector = new LanguageDetector();

  constructor(options: ConnectionPoolOptions = {}) {
    this.options = {
      healthCheckInterval: options.healthCheckInterval ?? 30000,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      idleTimeout: options.idleTimeout ?? 300000, // 5 minutes
    };

    // Register default servers
    Object.entries(DEFAULT_SERVERS).forEach(([lang, config]) => {
      this.registerLanguageServer(lang, config);
    });
  }

  registerLanguageServer(language: string, config: LanguageServerConfig): void {
    this.languageServers.set(language, config);
    this.logger.info(`Registered language server for ${language}`);
  }

  /**
   * Gets an LSP client for the specified language and workspace.
   * Throws an error if the language server is not registered or not available.
   * For a more lenient method that returns null instead of throwing, use getForFile().
   */
  async get(language: string, workspace: string): Promise<LSPClient> {
    const key = `${language}:${workspace}`;
    const existing = this.connections.get(key);

    if (existing && existing.client.isConnected()) {
      existing.lastUsed = new Date();
      return existing.client;
    }

    // Clean up dead connection if exists
    if (existing) {
      await this.disposeConnection(key);
    }

    // Try to get config from registered servers first
    let config = this.languageServers.get(language);

    // If no config and language is 'auto', detect from workspace
    if (!config && language === 'auto') {
      const detected = await this.languageDetector.detectLanguage(workspace);
      if (detected) {
        language = detected.id;

        // Validate serverCommand array before accessing
        if (!detected.serverCommand || detected.serverCommand.length === 0) {
          throw new Error(`No server command configured for language: ${language}`);
        }

        config = {
          command: detected.serverCommand[0]!,
          args: detected.serverCommand.slice(1),
        };

        // Check if server is available
        const provider = createLanguageServerProvider(detected);
        if (provider && !(await provider.isAvailable())) {
          const installCmd = this.getInstallCommand(language);
          this.logger.warn(
            `Language server for ${language} is not installed. ` +
              (installCmd
                ? `Please install it manually: ${installCmd}`
                : 'Please install it manually.')
          );
          throw new Error(
            `Language server for ${language} is not available. ` +
              (installCmd
                ? `Please install it manually: ${installCmd}`
                : 'Please install the language server manually.')
          );
        }
      }
    }

    if (!config) {
      throw new Error(`No language server registered for: ${language}`);
    }

    const client = await this.createConnection(language, workspace, config);
    const info: ConnectionInfo = {
      client,
      health: {
        status: 'healthy',
        lastCheck: new Date(),
        crashes: 0,
        uptime: 0,
        capabilities: client.getCapabilities() || undefined,
      },
      lastUsed: new Date(),
    };

    // Set up health monitoring
    if (this.options.healthCheckInterval > 0) {
      info.healthCheckInterval = setInterval(() => {
        void this.checkHealth(key);
      }, this.options.healthCheckInterval);
    }

    this.connections.set(key, info);
    return client;
  }

  private async createConnection(
    language: string,
    workspace: string,
    config: LanguageServerConfig,
    retryCount = 0
  ): Promise<LSPClient> {
    try {
      const client = new LSPClient(`${language}-${workspace}`, config, {
        workspaceFolders: [workspace],
      });

      client.on('crash', () => {
        this.handleCrashRecovery(language, workspace, config).catch((error) =>
          this.logger.error('Crash recovery failed:', error)
        );
      });

      await client.start();
      return client;
    } catch (error) {
      if (retryCount < this.options.maxRetries) {
        this.logger.warn(
          `Failed to start ${language} server, retrying (${retryCount + 1}/${this.options.maxRetries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, this.options.retryDelay));
        return this.createConnection(language, workspace, config, retryCount + 1);
      }
      throw error;
    }
  }

  private async restartConnection(
    key: string,
    language: string,
    workspace: string,
    config: LanguageServerConfig
  ): Promise<void> {
    await this.disposeConnection(key);

    const client = await this.createConnection(language, workspace, config);
    const info: ConnectionInfo = {
      client,
      health: {
        status: 'healthy',
        lastCheck: new Date(),
        crashes: this.connections.get(key)?.health.crashes || 0,
        uptime: 0,
        capabilities: client.getCapabilities() || undefined,
      },
      lastUsed: new Date(),
    };

    if (this.options.healthCheckInterval > 0) {
      info.healthCheckInterval = setInterval(() => {
        void this.checkHealth(key);
      }, this.options.healthCheckInterval);
    }

    this.connections.set(key, info);
  }

  private async checkHealth(key: string): Promise<void> {
    const info = this.connections.get(key);
    if (!info) return;

    const healthy = await info.client.ping();
    info.health.lastCheck = new Date();

    if (!healthy) {
      info.health.status = 'unhealthy';
      this.logger.warn(`Health check failed for ${key}`);
    } else {
      info.health.status = 'healthy';
      info.health.uptime = info.client.getUptime();
    }
  }

  async dispose(language: string, workspace: string): Promise<void> {
    const key = `${language}:${workspace}`;
    await this.disposeConnection(key);
  }

  private async disposeConnection(key: string): Promise<void> {
    const info = this.connections.get(key);
    if (!info) return;

    if (info.healthCheckInterval) {
      clearInterval(info.healthCheckInterval);
    }

    try {
      if (info.client.isConnected()) {
        await info.client.stop();
      }
    } catch (error) {
      this.logger.warn(`Error stopping client ${key}:`, error);
    }

    this.connections.delete(key);
  }

  async disposeAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((key) => this.disposeConnection(key));
    await Promise.all(promises);
  }

  getHealth(): Map<string, HealthStatus> {
    const health = new Map<string, HealthStatus>();
    this.connections.forEach((info, key) => {
      health.set(key, { ...info.health });
    });
    return health;
  }

  getDefaultServers(): Record<string, LanguageServerConfig> {
    return { ...DEFAULT_SERVERS };
  }

  /**
   * Gets an LSP client for a specific file path by detecting its language.
   * Returns null if the language cannot be detected or if the server is not available.
   * This method is more lenient than get() and will not throw errors.
   */
  async getForFile(filePath: string, workspace: string): Promise<LSPClient | null> {
    // Try to detect language from file extension
    const detected = this.languageDetector.detectLanguageByExtension(filePath);
    if (!detected) {
      return null;
    }

    // Update the detected language with the workspace root
    const detectedWithRoot = { ...detected, rootPath: workspace };

    // Check if language server is available
    const provider = createLanguageServerProvider(detectedWithRoot);
    if (provider && !(await provider.isAvailable())) {
      const installCmd = this.getInstallCommand(detected.id);
      this.logger.warn(
        `Language server for ${detected.id} is not installed. ` +
          (installCmd ? `Please install it manually: ${installCmd}` : 'Please install it manually.')
      );
      return null; // Return null if server is not available
    }

    // Get or create connection
    return this.get(detected.id, workspace);
  }

  private async handleCrashRecovery(
    language: string,
    workspace: string,
    config: LanguageServerConfig
  ): Promise<void> {
    const key = `${language}:${workspace}`;
    const info = this.connections.get(key);
    if (!info) return;

    info.health.crashes++;
    info.health.status = 'unhealthy';

    // Attempt recovery
    if (info.health.crashes <= this.options.maxRetries) {
      this.logger.info(`Attempting to restart ${language} server for ${workspace}`);
      info.health.status = 'restarting';

      try {
        await this.restartConnection(key, language, workspace, config);
      } catch (error) {
        this.logger.error(`Failed to restart ${language} server:`, error);
        throw error;
      }
    }
  }

  private getInstallCommand(language: string): string | null {
    const config = this.languageServers.get(language);
    if (!config) return null;

    if (config.npm) {
      return `npm install -g ${config.npm}`;
    } else if (config.pip) {
      return `pip install ${config.pip}`;
    }

    // Return null if no package manager info is available
    return null;
  }
}
