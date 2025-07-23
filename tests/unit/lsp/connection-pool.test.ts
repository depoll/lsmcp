import { describe, it, expect } from '@jest/globals';
import { ConnectionPoolOptions, HealthStatus } from '../../../src/types/lsp.js';

describe('ConnectionPool types', () => {
  it('should have correct health status structure', () => {
    const health: HealthStatus = {
      status: 'healthy',
      lastCheck: new Date(),
      crashes: 0,
      uptime: 100,
    };

    expect(health.status).toBe('healthy');
    expect(health.crashes).toBe(0);
    expect(health.uptime).toBe(100);
  });

  it('should have correct connection pool options', () => {
    const options: ConnectionPoolOptions = {
      healthCheckInterval: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      idleTimeout: 300000,
    };

    expect(options.healthCheckInterval).toBe(30000);
    expect(options.maxRetries).toBe(3);
  });
});
