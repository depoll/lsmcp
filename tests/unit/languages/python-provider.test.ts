import { jest } from '@jest/globals';
import type { DetectedLanguage } from '../../../src/languages/detector.js';

// Mock modules
const mockExistsSync = jest.fn<typeof import('fs').existsSync>();

jest.unstable_mockModule('fs', () => ({
  existsSync: mockExistsSync,
}));

// Import after mocking
const { PythonLanguageServerProvider } = await import('../../../src/languages/python-provider.js');

describe('PythonLanguageServerProvider', () => {
  let provider: typeof PythonLanguageServerProvider.prototype;
  let language: DetectedLanguage;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default to non-container environment
    delete process.env['CONTAINER'];
    delete process.env['DOCKER'];
    mockExistsSync.mockReturnValue(false);

    language = {
      id: 'python',
      name: 'Python',
      fileExtensions: ['.py', '.pyw', '.pyi'],
      serverCommand: ['python', '-m', 'pylsp'],
      rootPath: '/test/project',
    };

    provider = new PythonLanguageServerProvider(language);
  });

  describe('constructor', () => {
    it('should detect container environment via CONTAINER env var', () => {
      process.env['CONTAINER'] = 'true';
      const containerProvider = new PythonLanguageServerProvider(language);
      expect(containerProvider).toBeDefined();
    });

    it('should detect container environment via DOCKER env var', () => {
      process.env['DOCKER'] = 'true';
      const containerProvider = new PythonLanguageServerProvider(language);
      expect(containerProvider).toBeDefined();
    });

    it('should detect container environment via /.dockerenv file', () => {
      mockExistsSync.mockImplementation((path) => path === '/.dockerenv');
      const containerProvider = new PythonLanguageServerProvider(language);
      expect(containerProvider).toBeDefined();
    });
  });

  describe('getCommand', () => {
    it('should return default command when no Python detected', () => {
      const command = provider.getCommand();
      expect(command).toEqual(['python', '-m', 'pylsp']);
    });
  });

  describe('install', () => {
    it('should throw error in container environment', async () => {
      process.env['CONTAINER'] = 'true';
      const containerProvider = new PythonLanguageServerProvider(language);

      await expect(containerProvider.install({ force: true })).rejects.toThrow(
        'Language server installation in containers is not supported'
      );
    });

    it('should require force option', async () => {
      await expect(provider.install()).rejects.toThrow(
        'Auto-installation requires explicit user consent'
      );
    });
  });
});