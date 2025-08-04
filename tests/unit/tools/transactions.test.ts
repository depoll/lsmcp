import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WorkspaceEdit } from 'vscode-languageserver-protocol';
import { EditTransactionManager, TransactionError } from '../../../src/tools/transactions.js';

// Since the TransactionManager does file operations, we'll focus on testing
// the logic and behavior rather than mocking all file system operations

describe('EditTransactionManager', () => {
  let transactionManager: EditTransactionManager;

  beforeEach(() => {
    transactionManager = new EditTransactionManager();
  });

  describe('dry run mode', () => {
    it('should simulate changes without applying them', async () => {
      const edits: WorkspaceEdit[] = [
        {
          documentChanges: [
            {
              textDocument: { uri: 'file:///test/file1.ts', version: null },
              edits: [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'hello' },
                { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: 'world' },
              ],
            },
          ],
        },
        {
          changes: {
            'file:///test/file2.ts': [
              { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'foo' },
            ],
          },
        },
      ];

      const result = await transactionManager.executeTransaction(edits, { atomic: true, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.filesModified).toBe(2);
      expect(result.totalChanges).toBe(3);
      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toEqual({
        uri: 'file:///test/file1.ts',
        edits: 2,
      });
      expect(result.changes[1]).toEqual({
        uri: 'file:///test/file2.ts',
        edits: 1,
      });
    });

    it('should handle different edit types in dry run', async () => {
      const edits: WorkspaceEdit[] = [
        {
          documentChanges: [
            {
              kind: 'create',
              uri: 'file:///test/new-file.ts',
            },
            {
              kind: 'rename',
              oldUri: 'file:///test/old.ts',
              newUri: 'file:///test/new.ts',
            },
            {
              kind: 'delete',
              uri: 'file:///test/delete-me.ts',
            },
          ],
        },
      ];

      const result = await transactionManager.executeTransaction(edits, { atomic: true, dryRun: true });

      expect(result.success).toBe(true);
      // Resource operations don't count as file modifications in dry run
      expect(result.filesModified).toBe(0);
      expect(result.totalChanges).toBe(0);
    });
  });

  describe('transaction result creation', () => {
    it('should create correct success result structure', async () => {
      const edit: WorkspaceEdit = {
        changes: {
          'file:///test/file.ts': [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'test' },
          ],
        },
      };

      const result = await transactionManager.executeTransaction([edit], { atomic: true, dryRun: true });

      expect(result).toMatchObject({
        success: true,
        transactionId: expect.any(String),
        filesModified: 1,
        totalChanges: 1,
        changes: [
          {
            uri: 'file:///test/file.ts',
            edits: 1,
          },
        ],
      });
    });
  });

  describe('text edit logic', () => {
    it('should correctly calculate edit positions', () => {
      // Test the private applyTextEdit method logic
      const manager = transactionManager as any;
      const content = 'line 1\nline 2 with some text\nline 3';
      const edit = {
        range: { 
          start: { line: 1, character: 5 }, 
          end: { line: 1, character: 10 } 
        },
        newText: 'replaced'
      };

      const result = manager.applyTextEdit(content, edit);
      // Line 1 (index 1) is "line 2 with some text"
      // Characters 5-10 are "2 wit", replaced with "replaced"
      expect(result).toBe('line 1\nline replacedh some text\nline 3');
    });

    it('should handle multiline edits', () => {
      const manager = transactionManager as any;
      const content = 'line 1\nline 2\nline 3\nline 4';
      const edit = {
        range: { 
          start: { line: 1, character: 0 }, 
          end: { line: 2, character: 6 } 
        },
        newText: 'replaced content'
      };

      const result = manager.applyTextEdit(content, edit);
      expect(result).toBe('line 1\nreplaced content\nline 4');
    });

    it('should handle empty newText (deletion)', () => {
      const manager = transactionManager as any;
      const content = 'line 1\nline 2\nline 3';
      const edit = {
        range: { 
          start: { line: 1, character: 0 }, 
          end: { line: 1, character: 6 } 
        },
        newText: ''
      };

      const result = manager.applyTextEdit(content, edit);
      expect(result).toBe('line 1\n\nline 3');
    });
  });

  describe('error handling', () => {
    it('should handle TransactionError correctly', () => {
      const error = new TransactionError('Test error', 'test-id', new Error('Cause'));
      
      expect(error.message).toBe('Test error');
      expect(error.transactionId).toBe('test-id');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.name).toBe('TransactionError');
    });
  });

  describe('getAffectedUris', () => {
    it('should extract all affected URIs from edits', () => {
      const manager = transactionManager as any;
      const edits: WorkspaceEdit[] = [
        {
          documentChanges: [
            {
              textDocument: { uri: 'file:///test/file1.ts', version: null },
              edits: [],
            },
            {
              kind: 'create',
              uri: 'file:///test/file2.ts',
            },
            {
              kind: 'rename',
              oldUri: 'file:///test/old.ts',
              newUri: 'file:///test/new.ts',
            },
          ],
        },
        {
          changes: {
            'file:///test/file3.ts': [],
            'file:///test/file4.ts': [],
          },
        },
      ];

      const uris = manager.getAffectedUris(edits);
      
      expect(uris.size).toBe(6);
      expect(Array.from(uris).sort()).toEqual([
        'file:///test/file1.ts',
        'file:///test/file2.ts',
        'file:///test/file3.ts',
        'file:///test/file4.ts',
        'file:///test/new.ts',
        'file:///test/old.ts',
      ]);
    });
  });
});