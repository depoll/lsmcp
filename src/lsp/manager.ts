import { LSPClientV2 as LSPClient } from './client-v2.js';
import { 
  LanguageServerConfig, 
  HealthStatus, 
  ConnectionPoolOptions 
} from '../types/lsp.js';
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

    // Create new connection
    const config = this.languageServers.get(language);
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
      info.healthCheckInterval = setInterval(
        () => {
          void this.checkHealth(key);
        },
        this.options.healthCheckInterval
      );
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
        void (async () => {
        const key = `${language}:${workspace}`;
        const info = this.connections.get(key);
        if (info) {
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
            }
          }
        }
        })();
      });

      await client.start();
      return client;
    } catch (error) {
      if (retryCount < this.options.maxRetries) {
        this.logger.warn(
          `Failed to start ${language} server, retrying (${retryCount + 1}/${this.options.maxRetries})...`
        );
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
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
      info.healthCheckInterval = setInterval(
        () => {
          void this.checkHealth(key);
        },
        this.options.healthCheckInterval
      );
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
    const promises = Array.from(this.connections.keys()).map(key =>
      this.disposeConnection(key)
    );
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
}