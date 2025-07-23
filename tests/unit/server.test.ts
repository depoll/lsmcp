import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { LSMCPServer } from '../../src/server.js';

describe('LSMCPServer', () => {
  let server: LSMCPServer;

  beforeEach(() => {
    server = new LSMCPServer();
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
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
