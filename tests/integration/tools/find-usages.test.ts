import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FindUsagesTool } from '../../../src/tools/find-usages.js';
import { ConnectionPool } from '../../../src/lsp/index.js';
import { pathToFileUri } from '../../../src/utils/logger.js';
// import { TypeScriptLanguageProvider } from '../../../src/lsp/languages/typescript-provider.js';
import { join } from 'path';
import { writeFile, mkdir, rm } from 'fs/promises';
import type {
  FindUsagesParams,
  StreamingFindUsagesResult,
} from '../../../src/tools/find-usages.js';

describe('FindUsagesTool Integration', () => {
  let tool: FindUsagesTool;
  let connectionPool: ConnectionPool;
  let testDir: string;
  // let tsProvider: TypeScriptLanguageProvider;

  const createFindUsagesParams = (overrides: Partial<FindUsagesParams> = {}): FindUsagesParams => ({
    uri: pathToFileUri(join(testDir, 'test.ts')),
    position: { line: 0, character: 0 },
    type: 'references' as const,
    maxResults: 1000,
    maxDepth: 3,
    includeDeclaration: true,
    ...overrides,
  });

  beforeAll(async () => {
    // Create test directory with unique name to avoid race conditions
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    testDir = join(process.cwd(), 'tests', 'fixtures', `find-usages-test-${timestamp}-${random}`);
    await mkdir(testDir, { recursive: true });

    // Create test TypeScript files
    await writeFile(
      join(testDir, 'math.ts'),
      `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function calculate(x: number, y: number): number {
  const sum = add(x, y);
  const product = multiply(x, y);
  return sum + product;
}

export class Calculator {
  add(a: number, b: number): number {
    return add(a, b);
  }

  multiply(a: number, b: number): number {
    return multiply(a, b);
  }

  calculate(x: number, y: number): number {
    return calculate(x, y);
  }
}`
    );

    await writeFile(
      join(testDir, 'app.ts'),
      `import { add, multiply, calculate, Calculator } from './math.js';

const result1 = add(2, 3);
const result2 = multiply(4, 5);
const result3 = calculate(6, 7);

const calc = new Calculator();
const result4 = calc.add(8, 9);
const result5 = calc.multiply(10, 11);
const result6 = calc.calculate(12, 13);

function processNumbers(nums: number[]): number {
  return nums.reduce((acc, num, idx) => {
    if (idx % 2 === 0) {
      return add(acc, num);
    } else {
      return multiply(acc, num);
    }
  }, 0);
}

console.log(result1, result2, result3, result4, result5, result6);
console.log(processNumbers([1, 2, 3, 4, 5]));`
    );

    await writeFile(
      join(testDir, 'recursive.ts'),
      `export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export function ackermann(m: number, n: number): number {
  if (m === 0) return n + 1;
  if (n === 0) return ackermann(m - 1, 1);
  return ackermann(m - 1, ackermann(m, n - 1));
}`
    );

    await writeFile(
      join(testDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ES2020',
            moduleResolution: 'node',
            esModuleInterop: true,
            skipLibCheck: true,
            strict: true,
          },
        },
        null,
        2
      )
    );

    // Initialize connection pool with longer timeouts for integration tests
    connectionPool = new ConnectionPool({
      idleTimeout: 120000, // 2 minutes
      healthCheckInterval: 60000, // 1 minute
      maxRetries: 5,
      retryDelay: 2000, // 2 seconds between retries
    });

    // Pre-initialize and wait for TypeScript language server to be ready
    const fileUri = pathToFileUri(join(testDir, 'math.ts'));
    const connection = await connectionPool.getForFile(fileUri, testDir);

    if (!connection) {
      throw new Error('Failed to initialize TypeScript language server for integration tests');
    }

    // Wait for language server to index files
    console.log('Waiting for language server to index files...');
    await new Promise((resolve) => {
      setTimeout(resolve, 4000); // Increased from 3000ms and removed unref()
    }); // 4 second delay for CI stability

    // Initialize tool
    tool = new FindUsagesTool(connectionPool);
  }, 60000); // Increased timeout for integration test setup

  afterAll(async () => {
    await connectionPool.disposeAll();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('find references', () => {
    it('should find all references to add function', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 16 }, // Position of 'add' function name
        type: 'references',
        includeDeclaration: true,
      });

      const result = await tool.execute(params);

      expect(result.references).toBeDefined();

      expect(result.references!.length).toBeGreaterThan(0);

      // Should find references in both math.ts and app.ts
      const fileUris = new Set(result.references!.map((ref) => ref.uri));
      expect(fileUris.size).toBe(2);

      // Verify we found the declaration
      const declaration = result.references!.find((ref) => ref.kind === 'declaration');
      expect(declaration).toBeDefined();

      // Verify we found usage in app.ts
      const appUsages = result.references!.filter((ref) => ref.uri.endsWith('app.ts'));
      expect(appUsages.length).toBeGreaterThan(0);
    }, 30000);

    it('should find references without declaration', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 16 }, // Position of 'add' function
        type: 'references',
        includeDeclaration: false,
      });

      const result = await tool.execute(params);

      // Should not include the declaration itself
      const declaration = result.references!.find(
        (ref) => ref.uri.endsWith('math.ts') && ref.range.start.line === 0
      );
      expect(declaration).toBeUndefined();
    }, 30000);

    it('should find class instantiations', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 14, character: 13 }, // Position of 'Calculator' class name
        type: 'references',
        includeDeclaration: true,
      });

      const result = await tool.execute(params);

      expect(result.references).toBeDefined();

      // Should find the class instantiation in app.ts
      const instantiation = result.references!.find(
        (ref) => ref.uri.endsWith('app.ts') && ref.preview?.includes('new Calculator')
      );
      expect(instantiation).toBeDefined();
    }, 30000);

    it('should respect maxResults limit', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 16 }, // Position of 'add' function
        type: 'references',
        maxResults: 3,
      });

      const result = await tool.execute(params);

      expect(result.references!.length).toBeLessThanOrEqual(3);
      expect(result.total).toBeLessThanOrEqual(3);
    }, 30000);
  });

  describe('call hierarchy', () => {
    it('should find incoming calls', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 16 }, // Position of 'add' function
        type: 'callHierarchy',
        direction: 'incoming',
        maxDepth: 2,
      });

      const result = await tool.execute(params);

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.name).toBe('add');
      expect(result.hierarchy!.calls).toBeDefined();
      expect(result.hierarchy!.calls!.length).toBeGreaterThan(0);

      // Should find calls from calculate function and Calculator.add method
      const callerNames = result.hierarchy!.calls!.map((call) => call.name);
      expect(callerNames).toContain('calculate');
    }, 30000);

    it('should find outgoing calls', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 8, character: 16 }, // Position of 'calculate' function
        type: 'callHierarchy',
        direction: 'outgoing',
        maxDepth: 1,
      });

      const result = await tool.execute(params);

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.name).toBe('calculate');
      expect(result.hierarchy!.calls).toBeDefined();

      // Should find calls to add and multiply
      const calleeNames = result.hierarchy!.calls!.map((call) => call.name);
      expect(calleeNames).toContain('add');
      expect(calleeNames).toContain('multiply');
    }, 30000);

    it('should handle recursive calls', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'recursive.ts')),
        position: { line: 0, character: 16 }, // Position of 'factorial' function
        type: 'callHierarchy',
        direction: 'outgoing',
        maxDepth: 3,
      });

      const result = await tool.execute(params);

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy!.name).toBe('factorial');

      // Should find the recursive call but not infinitely recurse
      const recursiveCall = result.hierarchy!.calls!.find((call) => call.name === 'factorial');
      expect(recursiveCall).toBeDefined();

      // The recursive call should not have more recursive calls (cycle detection)
      expect(recursiveCall!.calls).toHaveLength(0);
    }, 30000);
  });

  describe('batch processing', () => {
    it('should process multiple symbols in batch', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 0 }, // Dummy position
        type: 'references',
        batch: [
          {
            uri: pathToFileUri(join(testDir, 'math.ts')),
            position: { line: 0, character: 16 }, // 'add' function
          },
          {
            uri: pathToFileUri(join(testDir, 'math.ts')),
            position: { line: 4, character: 16 }, // 'multiply' function
          },
        ],
      });

      const result = await tool.execute(params);

      expect(result.references).toBeDefined();

      // Should find references for both functions
      const uniqueUris = new Set(result.references!.map((ref) => ref.uri));
      expect(uniqueUris.size).toBeGreaterThanOrEqual(2);

      // Should deduplicate if same location appears for both
      const locationKeys = result.references!.map(
        (ref) => `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}`
      );
      const uniqueLocations = new Set(locationKeys);
      expect(uniqueLocations.size).toBe(locationKeys.length);
    }, 30000);
  });

  describe('streaming', () => {
    it('should stream reference results', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 0, character: 17 }, // 'add' function
        type: 'references',
      });

      const results: StreamingFindUsagesResult[] = [];
      for await (const result of tool.stream(params)) {
        results.push(result);
      }

      // Should have progress message
      expect(results[0]?.type).toBe('progress');
      expect(results[0]?.progress?.message).toContain('Finding references');

      // Should have at least one batch of results or complete message
      const hasPartialOrComplete = results.some(
        (r) => r.type === 'partial' || r.type === 'complete'
      );
      expect(hasPartialOrComplete).toBe(true);

      // Last message should be complete
      expect(results[results.length - 1]?.type).toBe('complete');
    }, 30000);

    it('should stream call hierarchy results', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 8, character: 17 }, // 'calculate' function
        type: 'callHierarchy',
        direction: 'outgoing',
      });

      const results: StreamingFindUsagesResult[] = [];
      for await (const result of tool.stream(params)) {
        results.push(result);
      }

      // Should have progress message
      expect(results[0]?.type).toBe('progress');
      expect(results[0]?.progress?.message).toContain('outgoing calls');

      // Should have complete message with data
      const completeResult = results.find((r) => r.type === 'complete');
      expect(completeResult).toBeDefined();
      expect(completeResult!.data).toBeDefined();
    }, 30000);
  });

  describe('error scenarios', () => {
    it('should handle invalid file URI gracefully', async () => {
      const params = createFindUsagesParams({
        uri: 'file:///non-existent-file.ts',
        position: { line: 0, character: 0 },
        type: 'references',
      });

      // Should either return empty results or throw a meaningful error
      try {
        const result = await tool.execute(params);
        expect(result.references).toHaveLength(0);
      } catch (error) {
        expect(error).toBeDefined();
      }
    }, 30000);

    it('should handle position outside of file bounds', async () => {
      const params = createFindUsagesParams({
        uri: pathToFileUri(join(testDir, 'math.ts')),
        position: { line: 9999, character: 9999 },
        type: 'references',
      });

      const result = await tool.execute(params);
      expect(result.references).toHaveLength(0);
    }, 30000);
  });
});
