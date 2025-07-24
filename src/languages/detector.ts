import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
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
          },
        },
      ],
    ]);
  }

  async detectLanguage(rootPath: string): Promise<DetectedLanguage | null> {
    logger.info({ rootPath }, 'Detecting language for project');

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

        if ('typescript' in allDeps || '@types/node' in allDeps) {
          logger.info({ rootPath }, 'Detected TypeScript project (TypeScript in package.json)');
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
    const extension = filePath.substring(filePath.lastIndexOf('.'));

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
