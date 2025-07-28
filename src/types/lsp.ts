import { ServerCapabilities } from 'vscode-languageserver-protocol';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'restarting';
  lastCheck: Date;
  crashes: number;
  uptime: number;
  capabilities?: ServerCapabilities;
}

export interface LanguageServerConfig {
  command: string;
  args: string[];
  npm?: string;
  pip?: string;
  containerCommand?: string;
  initializationOptions?: Record<string, unknown>;
}

export interface ConnectionPoolOptions {
  healthCheckInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  idleTimeout?: number;
}
