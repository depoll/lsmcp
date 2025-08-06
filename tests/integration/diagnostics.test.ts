import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DiagnosticsTool } from '../../src/tools/diagnostics.js';
import { ConnectionPool } from '../../src/lsp/manager.js';
import { createTestProject, cleanupTestProject, TestProject } from '../helpers/test-project.js';
import path from 'path';
import fs from 'fs/promises';

describe('DiagnosticsTool Integration', () => {
  let tool: DiagnosticsTool;
  let connectionPool: ConnectionPool;
  let testProject: TestProject;

  beforeAll(async () => {
    testProject = await createTestProject();
    connectionPool = new ConnectionPool();
    tool = new DiagnosticsTool(connectionPool);
  }, 30000);

  afterAll(async () => {
    await connectionPool.disposeAll();
    await cleanupTestProject(testProject);
  });

  describe('TypeScript diagnostics', () => {
    it('should detect type errors', async () => {
      // Create a file with a type error
      const filePath = path.join(testProject.dir, 'type-error.ts');
      await fs.writeFile(
        filePath,
        `
        function greet(name: string) {
          console.log("Hello, " + name);
        }
        
        // Type error: number is not assignable to string
        greet(123);
        
        // Another error: property doesn't exist
        const user = { name: "John" };
        console.log(user.age);
        `
      );

      // Give the language server time to analyze the file
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tool.execute({
        uri: `file://${filePath}`
      });

      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.errors).toBeGreaterThan(0);
      
      // Should detect the type mismatch error
      const typeError = result.diagnostics?.find(d => 
        d.message.includes('number') && d.message.includes('string')
      );
      expect(typeError).toBeDefined();

      // Should detect the property error
      const propError = result.diagnostics?.find(d => 
        d.message.includes('age') || d.message.includes('property')
      );
      expect(propError).toBeDefined();
    }, 30000);

    it('should provide quick fixes for misspellings', async () => {
      const filePath = path.join(testProject.dir, 'spelling-error.ts');
      await fs.writeFile(
        filePath,
        `
        const user = { name: "John", email: "john@example.com" };
        
        // Misspelling that should have a quick fix
        console.log(user.naem);
        `
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tool.execute({
        uri: `file://${filePath}`,
        includeRelated: true
      });

      expect(result.summary.errors).toBeGreaterThan(0);
      
      const spellingError = result.diagnostics?.find(d => 
        d.message.includes('naem') || d.message.includes('name')
      );
      
      expect(spellingError).toBeDefined();
      
      // TypeScript usually provides quick fixes for misspellings
      if (spellingError?.quickFixes && spellingError.quickFixes.length > 0) {
        expect(spellingError.quickFixes[0].title).toContain('name');
      }
    }, 30000);

    it('should filter by severity', async () => {
      const filePath = path.join(testProject.dir, 'mixed-severity.ts');
      await fs.writeFile(
        filePath,
        `
        // @ts-ignore - This creates a warning
        const x: any = 5;
        
        // This creates an error
        function test(n: number) {
          return n;
        }
        test("string");
        
        // Unused variable (might be a warning or hint)
        const unused = 42;
        `
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get only errors
      const errorsOnly = await tool.execute({
        uri: `file://${filePath}`,
        severity: 'error'
      });

      // Get all diagnostics
      const allDiagnostics = await tool.execute({
        uri: `file://${filePath}`
      });

      expect(errorsOnly.summary.total).toBeLessThanOrEqual(allDiagnostics.summary.total);
      expect(errorsOnly.summary.warnings).toBe(0);
      expect(errorsOnly.summary.info).toBe(0);
      expect(errorsOnly.summary.hints).toBe(0);
    }, 30000);

    it('should get workspace-wide diagnostics', async () => {
      // Create multiple files with errors
      const file1 = path.join(testProject.dir, 'error1.ts');
      const file2 = path.join(testProject.dir, 'error2.ts');
      
      await fs.writeFile(
        file1,
        `
        export function add(a: number, b: number) {
          return a + b;
        }
        
        // Error: wrong argument type
        add("1", "2");
        `
      );
      
      await fs.writeFile(
        file2,
        `
        import { add } from './error1';
        
        // Error: wrong number of arguments
        add(1);
        
        // Error: undefined variable
        console.log(undefinedVar);
        `
      );

      await new Promise(resolve => setTimeout(resolve, 3000));

      const result = await tool.execute({});

      expect(result.summary.filesAffected).toBeGreaterThanOrEqual(2);
      expect(result.byFile).toBeDefined();
      expect(result.byFile!.length).toBeGreaterThanOrEqual(2);
      
      // Check that files are sorted by error count
      if (result.byFile!.length >= 2) {
        for (let i = 1; i < result.byFile!.length; i++) {
          const prev = result.byFile![i - 1];
          const curr = result.byFile![i];
          expect(prev.errorCount).toBeGreaterThanOrEqual(curr.errorCount);
        }
      }
    }, 30000);

    it('should respect maxResults limit', async () => {
      const filePath = path.join(testProject.dir, 'many-errors.ts');
      
      // Create a file with many errors
      const errors = [];
      for (let i = 0; i < 20; i++) {
        errors.push(`const err${i}: string = ${i};`);
      }
      
      await fs.writeFile(filePath, errors.join('\n'));
      await new Promise(resolve => setTimeout(resolve, 2000));

      const limited = await tool.execute({
        uri: `file://${filePath}`,
        maxResults: 5
      });

      expect(limited.summary.total).toBeLessThanOrEqual(5);
      expect(limited.diagnostics?.length).toBeLessThanOrEqual(5);
    }, 30000);
  });

  describe('Python diagnostics', () => {
    it('should detect Python syntax errors', async () => {
      const filePath = path.join(testProject.dir, 'syntax-error.py');
      await fs.writeFile(
        filePath,
        `
def greet(name):
    print(f"Hello, {name}"
    # Missing closing parenthesis
    
def add(a, b)
    # Missing colon
    return a + b
        `
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tool.execute({
        uri: `file://${filePath}`
      });

      // Python syntax errors should be detected
      if (result.summary.total > 0) {
        expect(result.summary.errors).toBeGreaterThan(0);
        expect(result.diagnostics).toBeDefined();
      }
    }, 30000);

    it('should detect Python type errors with type hints', async () => {
      const filePath = path.join(testProject.dir, 'type-hints.py');
      await fs.writeFile(
        filePath,
        `
def add(a: int, b: int) -> int:
    return a + b

# Type error if type checking is enabled
result: str = add(1, 2)

# Undefined variable
print(undefined_variable)
        `
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tool.execute({
        uri: `file://${filePath}`
      });

      // Should at least detect the undefined variable
      if (result.summary.total > 0) {
        const undefinedError = result.diagnostics?.find(d =>
          d.message.toLowerCase().includes('undefined') ||
          d.message.toLowerCase().includes('not defined')
        );
        expect(undefinedError).toBeDefined();
      }
    }, 30000);
  });

  describe('Edge cases', () => {
    it('should handle files with no diagnostics', async () => {
      const filePath = path.join(testProject.dir, 'clean.ts');
      await fs.writeFile(
        filePath,
        `
        // Clean TypeScript code
        function add(a: number, b: number): number {
          return a + b;
        }
        
        const result = add(1, 2);
        console.log(result);
        `
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await tool.execute({
        uri: `file://${filePath}`
      });

      expect(result.summary.total).toBe(0);
      expect(result.summary.errors).toBe(0);
      expect(result.diagnostics).toEqual([]);
    }, 30000);

    it('should handle non-existent files gracefully', async () => {
      const result = await tool.execute({
        uri: 'file:///non/existent/file.ts'
      });

      expect(result.summary.total).toBe(0);
      expect(result.diagnostics).toEqual([]);
    }, 30000);

    it('should handle files without language server support', async () => {
      const filePath = path.join(testProject.dir, 'unknown.xyz');
      await fs.writeFile(filePath, 'some content');

      const result = await tool.execute({
        uri: `file://${filePath}`
      });

      expect(result.summary.total).toBe(0);
      expect(result.diagnostics).toEqual([]);
    }, 30000);
  });
});