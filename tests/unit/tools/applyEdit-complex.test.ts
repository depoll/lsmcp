import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ApplyEditTool } from '../../../src/tools/applyEdit.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkspaceEdit } from 'vscode-languageserver-protocol';

describe('ApplyEditTool - Complex Scenarios', () => {
  let tool: ApplyEditTool;
  let mockConnectionPool: jest.Mocked<ConnectionPool>;
  let testDir: string;
  let testFileUri: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(process.cwd(), 'test-temp-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    
    testFilePath = path.join(testDir, 'test.ts');
    testFileUri = `file://${testFilePath}`;

    // Create mock connection pool
    mockConnectionPool = {
      get: jest.fn(),
      getForFile: jest.fn(),
      dispose: jest.fn(),
      isConnected: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPool>;

    const mockClient = {
      isConnected: jest.fn().mockReturnValue(true),
    };

    mockConnectionPool.get.mockResolvedValue(mockClient as never);
    tool = new ApplyEditTool(mockConnectionPool);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Multi-line complex edits', () => {
    it('should apply multiple non-overlapping edits correctly', async () => {
      // Create initial file
      const initialContent = `class Calculator {
  add(a: number, b: number) {
    return a + b;
  }
  
  multiply(a: number, b: number) {
    return a * b;
  }
}`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      // Create complex multi-line edits
      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: testFileUri, version: null },
            edits: [
              // Add copyright header at beginning
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: '// Copyright 2024\n// Complex test\n\n',
              },
              // Rename class
              {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 16 } },
                newText: 'AdvancedCalc',
              },
              // Add logging to add method
              {
                range: { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } },
                newText: 'console.log(`Adding ${a} + ${b}`);\n    ',
              },
              // Add new method at end of class
              {
                range: { start: { line: 7, character: 3 }, end: { line: 7, character: 3 } },
                newText: '\n  \n  power(base: number, exp: number) {\n    return Math.pow(base, exp);\n  }',
              },
            ],
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      expect(result.data.summary).toContain('4 edits in 1 file');

      // Verify file content
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toContain('// Copyright 2024');
      expect(finalContent).toContain('AdvancedCalc');
      expect(finalContent).toContain('console.log(`Adding ${a} + ${b}`)');
      expect(finalContent).toContain('power(base: number, exp: number)');
    });

    it('should handle edits that span multiple lines', async () => {
      const initialContent = `function process(data: any) {
  if (data.type === 'user') {
    console.log('Processing user');
    return processUser(data);
  } else {
    console.log('Processing other');
    return processOther(data);
  }
}`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            // Replace entire if-else block
            {
              range: { 
                start: { line: 1, character: 2 }, 
                end: { line: 7, character: 3 } 
              },
              newText: `switch (data.type) {
    case 'user':
      console.log('User type detected');
      return processUser(data);
    case 'admin':
      console.log('Admin type detected');
      return processAdmin(data);
    default:
      console.log('Unknown type');
      return processOther(data);
  }`,
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toContain('switch (data.type)');
      expect(finalContent).toContain('case \'admin\'');
      expect(finalContent).not.toContain('if (data.type === \'user\')');
    });
  });

  describe('Overlapping edit detection', () => {
    it('should reject overlapping edits', async () => {
      const initialContent = `const x = 10;
const y = 20;
const z = 30;`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            // First edit: lines 0-1
            {
              range: { 
                start: { line: 0, character: 0 }, 
                end: { line: 1, character: 13 } 
              },
              newText: 'let a = 100;\nlet b = 200;',
            },
            // Second edit: overlaps with first (line 1)
            {
              range: { 
                start: { line: 1, character: 6 }, 
                end: { line: 2, character: 0 } 
              },
              newText: 'value = 999;\n',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('Overlapping text edits detected');
    });

    it('should accept adjacent non-overlapping edits', async () => {
      const initialContent = `line1
line2
line3
line4`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            // Edit at end of line 1
            {
              range: { 
                start: { line: 0, character: 5 }, 
                end: { line: 0, character: 5 } 
              },
              newText: ' // comment1',
            },
            // Edit at beginning of line 2 (adjacent but not overlapping)
            {
              range: { 
                start: { line: 1, character: 0 }, 
                end: { line: 1, character: 0 } 
              },
              newText: '// comment2 ',
            },
            // Edit at line 3
            {
              range: { 
                start: { line: 2, character: 0 }, 
                end: { line: 2, character: 5 } 
              },
              newText: 'LINE3',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toContain('line1 // comment1');
      expect(finalContent).toContain('// comment2 line2');
      expect(finalContent).toContain('LINE3');
    });
  });

  describe('Edge cases', () => {
    it('should handle edits on empty file', async () => {
      // Create empty file
      await fs.writeFile(testFilePath, '', 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            {
              range: { 
                start: { line: 0, character: 0 }, 
                end: { line: 0, character: 0 } 
              },
              newText: 'const hello = "world";\nconsole.log(hello);',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toBe('const hello = "world";\nconsole.log(hello);');
    });

    it('should handle edits at file boundaries', async () => {
      const initialContent = `first line
middle line
last line`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            // Insert at very beginning
            {
              range: { 
                start: { line: 0, character: 0 }, 
                end: { line: 0, character: 0 } 
              },
              newText: 'header\n',
            },
            // Append at very end
            {
              range: { 
                start: { line: 2, character: 9 }, 
                end: { line: 2, character: 9 } 
              },
              newText: '\nfooter',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toBe('header\nfirst line\nmiddle line\nlast line\nfooter');
    });

    it('should reject edits with invalid positions', async () => {
      const initialContent = `short`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            {
              range: { 
                start: { line: 0, character: 10 }, // Beyond line length
                end: { line: 0, character: 15 } 
              },
              newText: 'invalid',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('Invalid start character');
    });

    it('should reject edits on non-existent lines', async () => {
      const initialContent = `line1\nline2`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            {
              range: { 
                start: { line: 5, character: 0 }, // Line doesn't exist
                end: { line: 5, character: 0 } 
              },
              newText: 'new line',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(false);
      expect(result.data.failureReason).toContain('Invalid start line');
    });
  });

  describe('File operations', () => {
    it('should create new files', async () => {
      const newFileUri = `file://${path.join(testDir, 'new-file.ts')}`;
      
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
      const exists = await fs.access(fileURLToPath(newFileUri))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should delete files', async () => {
      const fileToDelete = path.join(testDir, 'delete-me.ts');
      const deleteUri = `file://${fileToDelete}`;
      await fs.writeFile(fileToDelete, 'content to delete', 'utf-8');

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'delete',
            uri: deleteUri,
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const exists = await fs.access(fileToDelete)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should rename files', async () => {
      const oldPath = path.join(testDir, 'old-name.ts');
      const newPath = path.join(testDir, 'new-name.ts');
      const oldUri = `file://${oldPath}`;
      const newUri = `file://${newPath}`;
      
      await fs.writeFile(oldPath, 'file content', 'utf-8');

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            kind: 'rename',
            oldUri,
            newUri,
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      
      const oldExists = await fs.access(oldPath)
        .then(() => true)
        .catch(() => false);
      expect(oldExists).toBe(false);
      
      const newExists = await fs.access(newPath)
        .then(() => true)
        .catch(() => false);
      expect(newExists).toBe(true);
      
      const content = await fs.readFile(newPath, 'utf-8');
      expect(content).toBe('file content');
    });

    it('should handle mixed text edits and file operations', async () => {
      const existingFile = path.join(testDir, 'existing.ts');
      const existingUri = `file://${existingFile}`;
      const newFile = path.join(testDir, 'created.ts');
      const newUri = `file://${newFile}`;
      
      await fs.writeFile(existingFile, 'original content', 'utf-8');

      const edit: WorkspaceEdit = {
        documentChanges: [
          // Create new file
          {
            kind: 'create',
            uri: newUri,
          },
          // Edit existing file
          {
            textDocument: { uri: existingUri, version: null },
            edits: [
              {
                range: { 
                  start: { line: 0, character: 0 }, 
                  end: { line: 0, character: 8 } 
                },
                newText: 'modified',
              },
            ],
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      
      const newExists = await fs.access(newFile)
        .then(() => true)
        .catch(() => false);
      expect(newExists).toBe(true);
      
      const modifiedContent = await fs.readFile(existingFile, 'utf-8');
      expect(modifiedContent).toBe('modified content');
    });
  });

  describe('Complex real-world scenarios', () => {
    it('should handle refactoring a class with multiple edits', async () => {
      const initialContent = `export class UserService {
  constructor(private db: Database) {}
  
  getUser(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
  }
  
  updateUser(id: string, data: any) {
    return this.db.query('UPDATE users SET ? WHERE id = ?', [data, id]);
  }
}`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: testFileUri, version: null },
            edits: [
              // Add imports at top
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: 'import { Logger } from \'./logger\';\nimport { User } from \'./types\';\n\n',
              },
              // Add logger to constructor
              {
                range: { start: { line: 1, character: 30 }, end: { line: 1, character: 30 } },
                newText: ', private logger: Logger',
              },
              // Add async and type annotations
              {
                range: { start: { line: 3, character: 2 }, end: { line: 3, character: 20 } },
                newText: 'async getUser(id: string): Promise<User>',
              },
              // Add logging
              {
                range: { start: { line: 4, character: 4 }, end: { line: 4, character: 4 } },
                newText: 'this.logger.info(`Fetching user ${id}`);\n    ',
              },
              // Update return statement
              {
                range: { start: { line: 4, character: 11 }, end: { line: 4, character: 11 } },
                newText: 'await ',
              },
              // Add async to updateUser
              {
                range: { start: { line: 7, character: 2 }, end: { line: 7, character: 12 } },
                newText: 'async updateUser',
              },
              // Add type for data parameter
              {
                range: { start: { line: 7, character: 31 }, end: { line: 7, character: 34 } },
                newText: 'Partial<User>',
              },
              // Add return type
              {
                range: { start: { line: 7, character: 35 }, end: { line: 7, character: 35 } },
                newText: ': Promise<void>',
              },
              // Add logging and await
              {
                range: { start: { line: 8, character: 4 }, end: { line: 8, character: 11 } },
                newText: 'this.logger.info(`Updating user ${id}`);\n    await ',
              },
            ],
          },
        ],
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      expect(result.data.summary).toContain('9 edits in 1 file');
      
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toContain('import { Logger }');
      expect(finalContent).toContain('import { User }');
      expect(finalContent).toContain('private logger: Logger');
      expect(finalContent).toContain('async getUser');
      expect(finalContent).toContain('Promise<User>');
      expect(finalContent).toContain('this.logger.info');
      expect(finalContent).toContain('await this.db.query');
      expect(finalContent).toContain('Partial<User>');
    });

    it('should handle adding JSDoc comments to multiple functions', async () => {
      const initialContent = `function add(a: number, b: number) {
  return a + b;
}

function multiply(x: number, y: number) {
  return x * y;
}

function divide(n: number, d: number) {
  if (d === 0) throw new Error('Division by zero');
  return n / d;
}`;
      await fs.writeFile(testFilePath, initialContent, 'utf-8');

      const edit: WorkspaceEdit = {
        changes: {
          [testFileUri]: [
            // Add JSDoc for add function
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: '/**\n * Adds two numbers together\n * @param a First number\n * @param b Second number\n * @returns Sum of a and b\n */\n',
            },
            // Add JSDoc for multiply function
            {
              range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
              newText: '/**\n * Multiplies two numbers\n * @param x First factor\n * @param y Second factor\n * @returns Product of x and y\n */\n',
            },
            // Add JSDoc for divide function
            {
              range: { start: { line: 8, character: 0 }, end: { line: 8, character: 0 } },
              newText: '/**\n * Divides two numbers\n * @param n Numerator\n * @param d Denominator\n * @returns Quotient of n divided by d\n * @throws {Error} When denominator is zero\n */\n',
            },
          ],
        },
      };

      const result = await tool.execute({ edit });

      expect(result.data.applied).toBe(true);
      const finalContent = await fs.readFile(testFilePath, 'utf-8');
      expect(finalContent).toContain('@param a First number');
      expect(finalContent).toContain('@param x First factor');
      expect(finalContent).toContain('@throws {Error}');
      expect(finalContent.match(/\/\*\*/g)?.length).toBe(3);
    });
  });
});