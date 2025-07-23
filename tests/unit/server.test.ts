import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPServer } from '../../src/server.js';

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer();
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
  });

  describe('health check', () => {
    it('should respond to health check requests', () => {
      const result = server.handleHealthCheck();
      expect(result).toEqual({
        status: 'healthy',
        version: expect.any(String),
        uptime: expect.any(Number),
      });
    });

    it('should report server version', () => {
      const result = server.handleHealthCheck();
      expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should track uptime in seconds', async () => {
      const firstCheck = server.handleHealthCheck();
      
      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const secondCheck = server.handleHealthCheck();
      expect(secondCheck.uptime).toBeGreaterThan(firstCheck.uptime);
    });
  });

  describe('lifecycle', () => {
    it('should start and stop cleanly', async () => {
      expect(server.isRunning()).toBe(false);
      
      await server.start();
      expect(server.isRunning()).toBe(true);
      
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow('Server is already running');
    });

    it('should handle stop when not running', async () => {
      await expect(server.stop()).rejects.toThrow('Server is not running');
    });
  });
});