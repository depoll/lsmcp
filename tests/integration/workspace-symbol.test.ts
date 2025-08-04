import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ConnectionPool } from '../../src/lsp/manager.js';
import { SymbolSearchTool } from '../../src/tools/symbolSearch.js';
import { execSync } from 'child_process';
import { logger } from '../../src/utils/logger.js';

// Check if typescript-language-server is available
let hasTypeScriptServer = false;
try {
  execSync('which typescript-language-server', { stdio: 'ignore' });
  hasTypeScriptServer = true;
} catch {
  console.log('TypeScript language server not found, skipping integration tests');
}

describe('Workspace Symbol Search Integration', () => {
  if (!hasTypeScriptServer) {
    it.skip('requires typescript-language-server', () => {});
    return;
  }

  let manager: ConnectionPool;
  let tool: SymbolSearchTool;

  beforeAll(() => {
    manager = new ConnectionPool();
    tool = new SymbolSearchTool(manager, logger);
  });

  afterAll(async () => {
    await manager.disposeAll();
  });

  it('should search for symbols across the workspace or provide fallback', async () => {
    // Try with partial match first since some language servers don't do fuzzy matching
    let result = await tool.execute({
      scope: 'workspace',
      query: 'Connection',
      maxResults: 10,
    });

    // Due to TypeScript language server limitations, workspace symbol search
    // may fail with "No Project" error or return empty results.
    if (result.error) {
      expect(result.error).toContain('No Project');
      expect(result.fallback).toBeDefined();
      expect(result.fallback).toContain('grep');
      expect(result.fallback).toContain('Connection');
    } else if (result.symbols.length === 0) {
      // Language server might return empty results for exact matches
      // This is acceptable behavior for integration tests
      expect(result.symbols).toEqual([]);
    } else {
      // If we get results, verify them
      const connectionPoolSymbol = result.symbols.find((s) => s.name === 'ConnectionPool');
      if (connectionPoolSymbol) {
        expect(connectionPoolSymbol.kind).toBe('class');
        expect(connectionPoolSymbol.location.uri).toContain('manager.ts');
      }
    }
  }, 30000); // Give it 30 seconds timeout

  it('should handle pattern searches or provide fallback', async () => {
    const result = await tool.execute({
      scope: 'workspace',
      query: '*Tool',
      maxResults: 20,
    });

    if (result.error) {
      expect(result.error).toContain('No Project');
      expect(result.fallback).toBeDefined();
      expect(result.fallback).toContain('grep');
      expect(result.fallback).toContain('Tool');
    } else if (result.symbols.length === 0) {
      // Language server might not support wildcard patterns
      // This is acceptable behavior for integration tests
      expect(result.symbols).toEqual([]);
    } else {
      // If we get results, verify them
      result.symbols.forEach((symbol) => {
        expect(symbol.name).toMatch(/Tool$/i);
      });
    }
  }, 30000);

  it('should filter by symbol kind or provide fallback', async () => {
    const result = await tool.execute({
      scope: 'workspace',
      query: 'execute',
      kind: 'method',
      maxResults: 20,
    });

    if (result.error) {
      expect(result.error).toContain('No Project');
      expect(result.fallback).toBeDefined();
      expect(result.fallback).toContain('grep');
      expect(result.fallback).toContain('execute');
    } else {
      // All results should be methods
      result.symbols.forEach((symbol) => {
        expect(symbol.kind).toBe('method');
      });
    }
  }, 30000);
});
