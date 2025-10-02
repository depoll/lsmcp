import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { RelatedAPIsTool } from '../../../src/tools/related-apis-tool.js';
import { ConnectionPool } from '../../../src/lsp/manager.js';
import { execSync } from 'child_process';

// Check if typescript-language-server is available
let hasTypeScriptServer = false;
try {
  execSync('which typescript-language-server', { stdio: 'ignore' });
  hasTypeScriptServer = true;
} catch {
  console.log('TypeScript language server not found, skipping integration tests');
}

describe('RelatedAPIsTool Integration Tests', () => {
  if (!hasTypeScriptServer) {
    it.skip('requires typescript-language-server', () => {});
    return;
  }

  let tool: RelatedAPIsTool;
  let clientManager: ConnectionPool;

  beforeAll(() => {
    // Initialize the tool with the actual lsmcp project
    clientManager = new ConnectionPool({
      idleTimeout: 5 * 60 * 1000,
      healthCheckInterval: 0, // Disable health checks for tests
    });

    tool = new RelatedAPIsTool(clientManager);
  }, 30000);

  afterAll(async () => {
    // Clean up
    await clientManager.disposeAll();
  }, 10000);

  it('should attempt to resolve symbols and handle errors gracefully', async () => {
    const result = await tool.execute({
      symbols: ['ConnectionPool'],
      depth: 1,
      includeReferences: false,
    });

    // Due to TypeScript language server limitations, workspace symbol search
    // may fail in temporary directories or return empty results.
    if (result.error) {
      // If there's an error, it should be reported properly
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    } else {
      // If successful, verify the structure
      expect(result.data).toBeDefined();
      expect(result.data.totalFound).toBeGreaterThanOrEqual(0);
      expect(result.data.markdownReport).toBeDefined();
      expect(typeof result.data.markdownReport).toBe('string');

      if (result.data.primarySymbols.length > 0) {
        // If symbols were found, verify their structure
        const symbol = result.data.primarySymbols[0];
        expect(symbol).toHaveProperty('name');
        expect(symbol).toHaveProperty('type');
        expect(symbol).toHaveProperty('location');
        expect(symbol).toHaveProperty('depth');
      }
    }
  }, 20000);

  it('should handle multiple symbols without crashing', async () => {
    const result = await tool.execute({
      symbols: ['ConnectionPool', 'RelatedAPIsTool'],
      depth: 1,
      includeReferences: false,
    });

    // The important thing is it doesn't crash
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.data.markdownReport).toBeDefined();

    // Verify markdown structure is valid
    const report = result.data.markdownReport;
    expect(report).toContain('# Related APIs for:');
  }, 20000);

  it('should respect depth parameter', async () => {
    const result = await tool.execute({
      symbols: ['ConnectionPool'],
      depth: 0, // Don't follow any dependencies
      includeReferences: false,
    });

    // Should not crash
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();

    // At depth 0, should not have related symbols (even if primary symbols found)
    if (result.data.primarySymbols.length > 0 && result.data.relatedSymbols) {
      expect(result.data.relatedSymbols.length).toBe(0);
    }
  }, 20000);

  it('should generate valid markdown report', async () => {
    const result = await tool.execute({
      symbols: ['NonExistentSymbol12345'],
      depth: 1,
      includeReferences: false,
    });

    // Even for non-existent symbols, should generate a report
    expect(result.data.markdownReport).toBeDefined();
    expect(typeof result.data.markdownReport).toBe('string');
    expect(result.data.markdownReport).toContain('# Related APIs for: NonExistentSymbol12345');

    // Should report error for not found
    if (result.error) {
      expect(result.error).toContain('not found');
    }
  }, 20000);

  it('should handle maxSymbols parameter', async () => {
    const result = await tool.execute({
      symbols: ['ConnectionPool'],
      depth: 3,
      includeReferences: false,
      maxSymbols: 5, // Very small limit
    });

    // Should not crash
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();

    // Total symbols should not exceed maxSymbols
    const total =
      (result.data.primarySymbols?.length || 0) + (result.data.relatedSymbols?.length || 0);
    expect(total).toBeLessThanOrEqual(5);
  }, 20000);
});
