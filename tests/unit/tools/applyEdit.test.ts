/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked functions are properly bound */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import type { LSPClient } from '../../../src/lsp/client-v2.js';
import { writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../../../src/lsp/index.js');

describe('ApplyEditTool', () => {
  let tool: ApplyEditTool;
  let mockClientManager: jest.Mocked<ConnectionPool>;
  let mockClient: jest.Mocked<LSPClient>;
  let testDir: string;
  let testFile: string;
  let testFileUri: string;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create a temporary test directory and file
    testDir = join(tmpdir(), `lsmcp-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'test.ts');
    testFileUri = `file://${testFile}`;

    mockClient = {
      sendRequest: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<LSPClient>;

    mockClientManager = {
      get: jest.fn(() => Promise.resolve(mockClient)),
    } as unknown as jest.Mocked<ConnectionPool>;

    tool = new ApplyEditTool(mockClientManager);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('execute', () => {
    it('should apply workspace edit successfully', async () => {
      // Create initial file content
      await writeFile(testFile, 'const x = 5;\n');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            TextEdit.replace(
              { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              'y'
            ),
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data).toMatchObject({
        applied: true,
        failureReason: undefined,
        failedChange: undefined,
      });
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toContain('File: ');
      expect(result.data.diff).toContain('@ Line 1');
    });

    it('should handle workspace edit with label', async () => {
      // Create initial file content
      await writeFile(testFile, 'const x = 5;\n');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            TextEdit.replace(
              { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              'y'
            ),
          ],
        },
      };

      const result = await tool.execute({ edit, label: 'Test Edit' });

      expect(result.data.applied).toBe(true);
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toBeDefined();
    });

    it('should handle failed workspace edit', async () => {
      // Don't create the file - it should fail
      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            TextEdit.replace(
              { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              'hello'
            ),
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data).toMatchObject({
        applied: false,
      });
      expect(result.data.failureReason).toContain('ENOENT');
      expect(result.data.failedChange).toContain('text edit');
      expect(result.data.summary).toBe('1 edit in 1 file');
      expect(result.data.diff).toContain('File: ');
      expect(result.data.diff).toContain('@ Line 1');
    });

    it('should handle error when no URI found in edit', async () => {
      const edit: WorkspaceEdit = {};

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('No URIs found in workspace edit');
      expect(result.error).toContain('No URIs found in workspace edit');
      expect(result.fallback).toBeDefined();
    });

    it('should handle error when no client available', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [],
        },
      };

      mockClientManager.get = jest.fn(() => Promise.resolve(null as unknown as LSPClient));

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('No language server available');
      expect(result.error).toContain('No language server available');
      expect(result.fallback).toBeDefined();
    });

    it('should handle error when client not connected', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [],
        },
      };

      mockClient.isConnected.mockReturnValue(false);

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('Language server not connected');
      expect(result.error).toContain('Language server not connected');
      expect(result.fallback).toBeDefined();
    });

    it('should extract URI from documentChanges', async () => {
      await writeFile(testFile, 'const x = 5;\n');

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: testFileUri, version: 1 },
            edits: [],
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      expect(jest.mocked(mockClientManager.get)).toHaveBeenCalledWith('typescript', testFileUri);
    });

    it('should skip language server for pure create file operation', async () => {
      const newFile = join(testDir, 'new.ts');
      const newFileUri = `file://${newFile}`;

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'create',
            uri: newFileUri,
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      // Should NOT call language server for pure file operations
      expect(jest.mocked(mockClientManager.get)).not.toHaveBeenCalled();
    });

    it('should skip language server for pure rename file operation', async () => {
      await writeFile(testFile, 'const x = 5;\n');
      const newFile = join(testDir, 'new.ts');
      const newFileUri = `file://${newFile}`;

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'rename',
            oldUri: testFileUri,
            newUri: newFileUri,
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      // Should NOT call language server for pure file operations
      expect(jest.mocked(mockClientManager.get)).not.toHaveBeenCalled();
    });

    it('should skip language server when create operation comes first', async () => {
      const newFile = join(testDir, 'new.ts');
      const newFileUri = `file://${newFile}`;

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'create',
            uri: newFileUri,
          },
          {
            textDocument: {
              uri: newFileUri,
              version: null,
            },
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: 'const x = 5;',
              },
            ],
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      // Should NOT call language server when creating a new file with content
      expect(jest.mocked(mockClientManager.get)).not.toHaveBeenCalled();
    });
  });

  describe('executeBatch', () => {
    it('should execute multiple operations in parallel', async () => {
      const testFile1 = join(testDir, 'test1.ts');
      const testFile2 = join(testDir, 'test2.ts');
      const testFileUri1 = `file://${testFile1}`;
      const testFileUri2 = `file://${testFile2}`;

      await writeFile(testFile1, 'const x = 5;\n');
      await writeFile(testFile2, 'const y = 10;\n');

      const edits = [
        {
          edit: {
            changes: {
              [testFileUri1]: [],
            },
          } as WorkspaceEdit,
        },
        {
          edit: {
            changes: {
              [testFileUri2]: [],
            },
          } as WorkspaceEdit,
        },
      ];

      const results = await tool.executeBatch(edits);

      expect(results).toHaveLength(2);
      expect(results[0]?.data.applied).toBe(true);
      expect(results[1]?.data.applied).toBe(true);
    });
  });
});
