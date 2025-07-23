import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ConnectionPool } from '../../src/lsp/manager.js';
import { execSync } from 'child_process';

describe('TypeScript Language Server Integration', () => {
  let pool: ConnectionPool;
  let hasTypeScriptServer = false;

  beforeAll(() => {
    // Check if typescript-language-server is available
    try {
      execSync('which typescript-language-server', { stdio: 'ignore' });
      hasTypeScriptServer = true;
    } catch {
      console.log('TypeScript language server not found, skipping integration tests');
    }

    pool = new ConnectionPool({
      healthCheckInterval: 1000,
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.disposeAll();
    }
  });

  it('should connect to TypeScript language server', async () => {
    if (!hasTypeScriptServer) {
      console.log('Skipping: TypeScript language server not installed');
      return;
    }

    const client = await pool.get('typescript', process.cwd());
    expect(client).toBeDefined();
    expect(client.isConnected()).toBe(true);

    const capabilities = client.getCapabilities();
    expect(capabilities).toBeDefined();
  });

  it('should reuse connection for same workspace', async () => {
    if (!hasTypeScriptServer) {
      return;
    }

    const client1 = await pool.get('typescript', process.cwd());
    const client2 = await pool.get('typescript', process.cwd());

    expect(client1).toBe(client2);
  });

  it('should track health status', async () => {
    if (!hasTypeScriptServer) {
      return;
    }

    await pool.get('typescript', process.cwd());

    const health = pool.getHealth();
    const tsHealth = health.get(`typescript:${process.cwd()}`);

    expect(tsHealth).toBeDefined();
    expect(tsHealth?.status).toBe('healthy');
    expect(tsHealth?.crashes).toBe(0);
  });
});
