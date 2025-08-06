import { existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { logger } from '../utils/logger.js';

export interface DetectedLanguage {
  id: string;
  name: string;
  fileExtensions: string[];
  serverCommand: string[];
  serverArgs?: string[];
  rootPath: string;
  initializationOptions?: Record<string, unknown>;
}

export class LanguageDetector {
  private readonly languageConfigs: Map<string, Omit<DetectedLanguage, 'rootPath'>>;

  constructor() {
    this.languageConfigs = new Map([
      [
        'typescript',
        {
          id: 'typescript',
          name: 'TypeScript',
          fileExtensions: ['.ts', '.tsx', '.mts', '.cts'],
          serverCommand: ['typescript-language-server', '--stdio'],
          initializationOptions: {
            preferences: {
              includeInlayParameterNameHints: 'all',
              includeInlayParameterNameHintsWhenArgumentMatchesName: true,
              includeInlayFunctionParameterTypeHints: true,
              includeInlayVariableTypeHints: true,
              includeInlayPropertyDeclarationTypeHints: true,
              includeInlayFunctionLikeReturnTypeHints: true,
              includeInlayEnumMemberValueHints: true,
            },
            tsserver: {
              // Enable logging for debugging
              logVerbosity: 'off',
              // Ensure TypeScript server loads the project
              maxTsServerMemory: 4096,
            },
            hostInfo: 'lsmcp',
          },
        },
      ],
      [
        'javascript',
        {
          id: 'javascript',
          name: 'JavaScript',
          fileExtensions: ['.js', '.jsx', '.mjs', '.cjs'],
          serverCommand: ['typescript-language-server', '--stdio'],
          initializationOptions: {
            preferences: {
              includeInlayParameterNameHints: 'all',
              includeInlayParameterNameHintsWhenArgumentMatchesName: true,
              includeInlayFunctionParameterTypeHints: true,
              includeInlayVariableTypeHints: true,
              includeInlayPropertyDeclarationTypeHints: true,
              includeInlayFunctionLikeReturnTypeHints: true,
              includeInlayEnumMemberValueHints: true,
            },
            tsserver: {
              // Enable logging for debugging
              logVerbosity: 'off',
              // Ensure TypeScript server loads the project
              maxTsServerMemory: 4096,
            },
            hostInfo: 'lsmcp',
          },
        },
      ],
      [
        'python',
        {
          id: 'python',
          name: 'Python',
          fileExtensions: ['.py', '.pyw', '.pyi'],
          serverCommand: ['python', '-m', 'pylsp'],
          initializationOptions: {
            pylsp: {
              plugins: {
                // Disable slow plugins for AI usage
                pycodestyle: { enabled: false },
                mccabe: { enabled: false },
                pyflakes: { enabled: true },
                pylint: { enabled: false },
                // Enable fast, useful plugins
                jedi_completion: {
                  enabled: true,
                  include_params: true,
                  include_class_objects: true,
                  fuzzy: true,
                },
                jedi_definition: { enabled: true },
                jedi_hover: { enabled: true },
                jedi_references: { enabled: true },
                jedi_signature_help: { enabled: true },
                jedi_symbols: { enabled: true },
              },
            },
          },
        },
      ],
    ]);
  }

  async detectLanguage(rootPath: string): Promise<DetectedLanguage | null> {
    logger.info({ rootPath }, 'Detecting language for project');

    // Check for Python project files
    const pythonFiles = [
      'setup.py',
      'pyproject.toml',
      'requirements.txt',
      'Pipfile',
      'poetry.lock',
    ];
    for (const file of pythonFiles) {
      if (existsSync(join(rootPath, file))) {
        logger.info({ rootPath, file }, 'Detected Python project');
        const config = this.languageConfigs.get('python')!;
        return { ...config, rootPath };
      }
    }

    // Check for .py files in root
    let hasPyFiles = false;
    try {
      hasPyFiles = readdirSync(rootPath).some(
        (file) => extname(file) === '.py'
      );
    } catch (e) {
      logger.warn({ error: e, rootPath }, 'Failed to read directory for Python files');
    }
    if (hasPyFiles) {
      logger.info({ rootPath }, 'Detected Python project (Python files found)');
      const config = this.languageConfigs.get('python')!;
      return { ...config, rootPath };
    }

    // Check for TypeScript configuration files
    const tsConfigPath = join(rootPath, 'tsconfig.json');
    const jsConfigPath = join(rootPath, 'jsconfig.json');

    if (existsSync(tsConfigPath)) {
      logger.info({ rootPath }, 'Detected TypeScript project (tsconfig.json found)');
      const config = this.languageConfigs.get('typescript')!;
      return { ...config, rootPath };
    }

    if (existsSync(jsConfigPath)) {
      logger.info({ rootPath }, 'Detected JavaScript project (jsconfig.json found)');
      const config = this.languageConfigs.get('javascript')!;
      return { ...config, rootPath };
    }

    // Check package.json for TypeScript dependencies
    const packageJsonPath = join(rootPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const allDeps = {
          ...(packageJson.dependencies || {}),
          ...(packageJson.devDependencies || {}),
        };

        // Check for TypeScript indicators
        const hasTypeScriptDep = 'typescript' in allDeps;
        const hasTypesPackages = Object.keys(allDeps).some((dep) => dep.startsWith('@types/'));
        const hasTsRelatedTools = ['ts-node', 'tsx', 'ts-jest', '@swc/core', 'esbuild'].some(
          (tool) => tool in allDeps
        );

        if (hasTypeScriptDep || hasTypesPackages || hasTsRelatedTools) {
          logger.info(
            { rootPath },
            'Detected TypeScript project (TypeScript indicators in package.json)'
          );
          const config = this.languageConfigs.get('typescript')!;
          return { ...config, rootPath };
        }

        // Default to JavaScript if package.json exists
        logger.info({ rootPath }, 'Detected JavaScript project (package.json found)');
        const config = this.languageConfigs.get('javascript')!;
        return { ...config, rootPath };
      } catch (error) {
        logger.warn({ error, rootPath }, 'Failed to parse package.json');
      }
    }

    logger.info({ rootPath }, 'No language detected for project');
    return null;
  }

  detectLanguageByExtension(filePath: string): DetectedLanguage | null {
    // Use Node's path.extname for consistent extension extraction
    const extension = extname(filePath);

    // No extension found (includes dotfiles without extensions like .gitignore)
    if (!extension) {
      return null;
    }

    for (const [, config] of this.languageConfigs) {
      if (config.fileExtensions.includes(extension)) {
        logger.debug({ filePath, language: config.id }, 'Detected language by file extension');
        // Return with empty rootPath - caller should set appropriate root
        return { ...config, rootPath: '' };
      }
    }

    return null;
  }

  getSupportedLanguages(): string[] {
    return Array.from(this.languageConfigs.keys());
  }

  getLanguageConfig(languageId: string): Omit<DetectedLanguage, 'rootPath'> | null {
    return this.languageConfigs.get(languageId) || null;
  }
}
