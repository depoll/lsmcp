import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { LanguageDetector as LanguageDetectorType } from '../../../src/languages/detector.js';

// Create mocks before importing
const mockExistsSync = jest.fn<typeof import('fs').existsSync>();
const mockReadFile = jest.fn<typeof import('fs/promises').readFile>();

// Mock modules
jest.unstable_mockModule('fs', () => ({
  existsSync: mockExistsSync,
}));

jest.unstable_mockModule('fs/promises', () => ({
  readFile: mockReadFile,
}));

// Import after mocks are set up
const { LanguageDetector } = await import('../../../src/languages/detector.js');

describe('LanguageDetector', () => {
  let detector: LanguageDetectorType;

  beforeEach(() => {
    detector = new LanguageDetector();
    jest.clearAllMocks();
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript project by tsconfig.json', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('tsconfig.json');
      });

      const result = await detector.detectLanguage('/test/project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
      expect(result?.name).toBe('TypeScript');
      expect(result?.rootPath).toBe('/test/project');
      expect(result?.serverCommand).toEqual(['typescript-language-server', '--stdio']);
    });

    it('should detect JavaScript project by jsconfig.json', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('jsconfig.json');
      });

      const result = await detector.detectLanguage('/test/project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('javascript');
      expect(result?.name).toBe('JavaScript');
      expect(result?.rootPath).toBe('/test/project');
    });

    it('should detect TypeScript project by package.json dependencies', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('package.json');
      });
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            typescript: '^5.0.0',
          },
        })
      );

      const result = await detector.detectLanguage('/test/project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
    });

    it('should detect TypeScript project by @types/node in devDependencies', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('package.json');
      });
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          devDependencies: {
            '@types/node': '^20.0.0',
          },
        })
      );

      const result = await detector.detectLanguage('/test/project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
    });

    it('should detect JavaScript project by package.json without TypeScript', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('package.json');
      });
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            express: '^4.0.0',
          },
        })
      );

      const result = await detector.detectLanguage('/test/project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('javascript');
    });

    it('should return null when no language is detected', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await detector.detectLanguage('/test/project');

      expect(result).toBeNull();
    });

    it('should handle invalid package.json gracefully', async () => {
      mockExistsSync.mockImplementation((path) => {
        return path.toString().endsWith('package.json');
      });
      mockReadFile.mockResolvedValue('invalid json');

      const result = await detector.detectLanguage('/test/project');

      expect(result).toBeNull();
    });
  });

  describe('detectLanguageByExtension', () => {
    it('should detect TypeScript by .ts extension', () => {
      const result = detector.detectLanguageByExtension('/test/file.ts');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
      expect(result?.fileExtensions).toContain('.ts');
    });

    it('should detect TypeScript by .tsx extension', () => {
      const result = detector.detectLanguageByExtension('/test/component.tsx');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
      expect(result?.fileExtensions).toContain('.tsx');
    });

    it('should detect JavaScript by .js extension', () => {
      const result = detector.detectLanguageByExtension('/test/script.js');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('javascript');
      expect(result?.fileExtensions).toContain('.js');
    });

    it('should detect JavaScript by .jsx extension', () => {
      const result = detector.detectLanguageByExtension('/test/component.jsx');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('javascript');
      expect(result?.fileExtensions).toContain('.jsx');
    });

    it('should return null for unknown extension', () => {
      const result = detector.detectLanguageByExtension('/test/file.xyz');

      expect(result).toBeNull();
    });

    it('should return empty rootPath for extension detection', () => {
      const result = detector.detectLanguageByExtension('/test/file.ts');

      expect(result?.rootPath).toBe('');
    });

    it('should handle dotfiles without extensions correctly', () => {
      // Dotfiles like .gitignore should be treated as having the whole filename as extension
      const result = detector.detectLanguageByExtension('/test/.gitignore');

      // Since .gitignore is not in our language configs, it should return null
      expect(result).toBeNull();
    });

    it('should handle dotfiles with extensions correctly', () => {
      // Files like .eslintrc.js should detect the .js extension
      const result = detector.detectLanguageByExtension('/test/.eslintrc.js');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('javascript');
    });

    it('should handle files with multiple dots correctly', () => {
      // Files like file.test.ts should detect the .ts extension
      const result = detector.detectLanguageByExtension('/test/file.test.ts');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('typescript');
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return list of supported languages', () => {
      const languages = detector.getSupportedLanguages();

      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getLanguageConfig', () => {
    it('should return config for known language', () => {
      const config = detector.getLanguageConfig('typescript');

      expect(config).not.toBeNull();
      expect(config?.id).toBe('typescript');
      expect(config?.name).toBe('TypeScript');
    });

    it('should return null for unknown language', () => {
      const config = detector.getLanguageConfig('unknown');

      expect(config).toBeNull();
    });
  });
});
