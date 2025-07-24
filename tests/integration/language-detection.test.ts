import { describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { ConnectionPool } from '../../src/lsp/index.js';
import { LanguageDetector } from '../../src/languages/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);

describe('Language Detection Integration Tests', () => {
  let pool: ConnectionPool;
  let tempDir: string;
  let hasTypeScriptServer = false;

  beforeAll(async () => {
    // Check if typescript-language-server is available
    try {
      await execAsync('typescript-language-server --version');
      hasTypeScriptServer = true;
    } catch {
      console.log('TypeScript language server not found, some tests will be skipped');
    }
  });

  beforeEach(async () => {
    pool = new ConnectionPool();
    tempDir = await mkdtemp(join(tmpdir(), 'lsmcp-test-'));
  });

  afterEach(async () => {
    await pool.disposeAll();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('LanguageDetector', () => {
    it('should detect TypeScript project with tsconfig.json', async () => {
      const detector = new LanguageDetector();

      // Create a minimal TypeScript project
      await writeFile(
        join(tempDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
          },
        })
      );

      const detected = await detector.detectLanguage(tempDir);

      expect(detected).not.toBeNull();
      expect(detected?.id).toBe('typescript');
      expect(detected?.serverCommand).toEqual(['typescript-language-server', '--stdio']);
    });

    it('should detect JavaScript project with jsconfig.json', async () => {
      const detector = new LanguageDetector();

      // Create a minimal JavaScript project
      await writeFile(
        join(tempDir, 'jsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            checkJs: true,
          },
        })
      );

      const detected = await detector.detectLanguage(tempDir);

      expect(detected).not.toBeNull();
      expect(detected?.id).toBe('javascript');
    });

    it('should detect TypeScript from package.json', async () => {
      const detector = new LanguageDetector();

      // Create package.json with TypeScript dependency
      await writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          devDependencies: {
            typescript: '^5.0.0',
          },
        })
      );

      const detected = await detector.detectLanguage(tempDir);

      expect(detected).not.toBeNull();
      expect(detected?.id).toBe('typescript');
    });

    it('should detect language by file extension', () => {
      const detector = new LanguageDetector();

      expect(detector.detectLanguageByExtension('test.ts')?.id).toBe('typescript');
      expect(detector.detectLanguageByExtension('test.tsx')?.id).toBe('typescript');
      expect(detector.detectLanguageByExtension('test.js')?.id).toBe('javascript');
      expect(detector.detectLanguageByExtension('test.jsx')?.id).toBe('javascript');
      expect(detector.detectLanguageByExtension('test.py')).toBeNull();
    });
  });

  describe('ConnectionPool with language detection', () => {
    if (!hasTypeScriptServer) {
      it.skip('requires typescript-language-server', () => {});
      return;
    }

    it('should auto-detect TypeScript project', async () => {
      // Create a TypeScript project
      await writeFile(
        join(tempDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
          },
        })
      );
      await writeFile(join(tempDir, 'test.ts'), 'const x: number = 42;');

      // Use 'auto' to trigger detection
      const client = await pool.get('auto', tempDir);

      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(true);

      // Verify it's connected to TypeScript server
      const capabilities = client.getCapabilities();
      expect(capabilities).toBeDefined();
    });

    it('should get client for specific file', async () => {
      // Create a TypeScript file
      const filePath = join(tempDir, 'example.ts');
      await writeFile(
        filePath,
        'function greet(name: string): string { return `Hello, ${name}`; }'
      );

      const client = await pool.getForFile(filePath, tempDir);

      expect(client).not.toBeNull();
      expect(client?.isConnected()).toBe(true);
    });

    it('should return null for unsupported file type', async () => {
      const filePath = join(tempDir, 'example.xyz');
      const client = await pool.getForFile(filePath, tempDir);

      expect(client).toBeNull();
    });
  });
});
