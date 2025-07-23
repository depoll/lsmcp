import { describe, it, expect, beforeEach } from '@jest/globals';
import { LSPClientV2 } from '../../../src/lsp/client-v2.js';
import { LanguageServerConfig } from '../../../src/types/lsp.js';

describe('LSPClientV2', () => {
  let client: LSPClientV2;
  let config: LanguageServerConfig;

  beforeEach(() => {
    config = {
      command: 'typescript-language-server',
      args: ['--stdio'],
    };
    client = new LSPClientV2('test-client', config);
  });

  it('should create client with correct id', () => {
    expect(client.getId()).toBe('test-client');
  });

  it('should not be connected initially', () => {
    expect(client.isConnected()).toBe(false);
  });

  it('should have null capabilities when not connected', () => {
    expect(client.getCapabilities()).toBeNull();
  });

  it('should have zero uptime initially', () => {
    expect(client.getUptime()).toBe(0);
  });

  it('should throw when stopping unconnected client', async () => {
    await expect(client.stop()).rejects.toThrow('Client is not connected');
  });

  it('should throw when sending request to unconnected client', async () => {
    await expect(client.sendRequest('test', {})).rejects.toThrow('Client is not connected');
  });

  it('should create client with custom options', () => {
    const customClient = new LSPClientV2('custom', config, {
      startTimeout: 60000,
      requestTimeout: 10000,
      workspaceFolders: ['/workspace'],
    });
    expect(customClient.getId()).toBe('custom');
  });
});
