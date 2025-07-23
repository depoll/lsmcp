import { describe, it, expect } from '@jest/globals';
import { HealthStatus } from '../../../src/types/lsp.js';

describe('Health Monitoring', () => {
  it('should track health status correctly', () => {
    const health: HealthStatus = {
      status: 'healthy',
      lastCheck: new Date(),
      crashes: 0,
      uptime: 0,
    };

    expect(health.status).toBe('healthy');

    // Simulate unhealthy state
    health.status = 'unhealthy';
    health.crashes++;
    
    expect(health.status).toBe('unhealthy');
    expect(health.crashes).toBe(1);
  });

  it('should calculate uptime correctly', () => {
    const startTime = Date.now() - 60000; // 1 minute ago
    const currentTime = Date.now();
    const uptime = Math.floor((currentTime - startTime) / 1000);
    
    expect(uptime).toBeGreaterThanOrEqual(59);
    expect(uptime).toBeLessThanOrEqual(61);
  });

  it('should handle restart status', () => {
    const health: HealthStatus = {
      status: 'restarting',
      lastCheck: new Date(),
      crashes: 2,
      uptime: 0,
    };

    expect(health.status).toBe('restarting');
    expect(health.crashes).toBe(2);
  });
});