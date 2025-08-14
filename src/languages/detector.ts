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
      [
        'rust',
        {
          id: 'rust',
          name: 'Rust',
          fileExtensions: ['.rs', '.toml'],
          serverCommand: ['rust-analyzer'],
          initializationOptions: {
            checkOnSave: {
              command: 'clippy',
            },
          },
        },
      ],
      [
        'go',
        {
          id: 'go',
          name: 'Go',
          fileExtensions: ['.go', '.mod'],
          serverCommand: ['gopls'],
          initializationOptions: {
            // Enable all analyses
            analyses: {
              unusedparams: true,
              unusedresult: true,
            },
            // Enable inlay hints
            hints: {
              assignVariableTypes: true,
              compositeLiteralFields: true,
              compositeLiteralTypes: true,
              constantValues: true,
              functionTypeParameters: true,
              parameterNames: true,
              rangeVariableTypes: true,
            },
          },
        },
      ],
      [
        'csharp',
        {
          id: 'csharp',
          name: 'C#',
          fileExtensions: ['.cs', '.csx', '.cake'],
          serverCommand: ['csharp-ls'],
        },
      ],
      [
        'java',
        {
          id: 'java',
          name: 'Java',
          fileExtensions: ['.java'],
          serverCommand: [
            'java',
            '-jar',
            '/opt/eclipse.jdt.ls/plugins/org.eclipse.equinox.launcher_*.jar',
            '-configuration',
            '/opt/eclipse.jdt.ls/config_linux',
          ],
        },
      ],
      [
        'c',
        {
          id: 'c',
          name: 'C',
          fileExtensions: ['.c', '.h'],
          serverCommand: ['clangd'],
        },
      ],
      [
        'cpp',
        {
          id: 'cpp',
          name: 'C++',
          fileExtensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h++'],
          serverCommand: ['clangd'],
        },
      ],
      [
        'objective-c',
        {
          id: 'objective-c',
          name: 'Objective-C',
          fileExtensions: ['.m', '.mm'],
          serverCommand: ['clangd'],
        },
      ],
      [
        'bash',
        {
          id: 'bash',
          name: 'Bash',
          fileExtensions: ['.sh', '.bash', '.zsh', '.fish'],
          serverCommand: ['bash-language-server'],
        },
      ],
      [
        'json',
        {
          id: 'json',
          name: 'JSON',
          fileExtensions: ['.json', '.jsonc', '.json5'],
          serverCommand: ['vscode-json-language-server'],
        },
      ],
      [
        'yaml',
        {
          id: 'yaml',
          name: 'YAML',
          fileExtensions: ['.yaml', '.yml'],
          serverCommand: ['yaml-language-server', '--stdio'],
        },
      ],
      [
        'html',
        {
          id: 'html',
          name: 'HTML',
          fileExtensions: ['.html', '.htm'],
          serverCommand: ['vscode-html-language-server', '--stdio'],
        },
      ],
      [
        'css',
        {
          id: 'css',
          name: 'CSS',
          fileExtensions: ['.css', '.scss', '.sass', '.less'],
          serverCommand: ['vscode-css-language-server', '--stdio'],
        },
      ],
      [
        'ruby',
        {
          id: 'ruby',
          name: 'Ruby',
          fileExtensions: ['.rb', '.erb', '.rake', '.gemspec'],
          serverCommand: ['solargraph', 'stdio'],
        },
      ],
      [
        'php',
        {
          id: 'php',
          name: 'PHP',
          fileExtensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'],
          serverCommand: ['intelephense', '--stdio'],
        },
      ],
      [
        'kotlin',
        {
          id: 'kotlin',
          name: 'Kotlin',
          fileExtensions: ['.kt', '.kts', '.ktm'],
          serverCommand: ['kotlin-language-server'],
        },
      ],
      [
        'swift',
        {
          id: 'swift',
          name: 'Swift',
          fileExtensions: ['.swift'],
          serverCommand: ['sourcekit-lsp'],
        },
      ],
    ]);
  }

  async detectLanguage(rootPath: string): Promise<DetectedLanguage | null> {
    logger.info({ rootPath }, 'Detecting language for project');

    // Check for Rust project files
    if (existsSync(join(rootPath, 'Cargo.toml'))) {
      logger.info({ rootPath }, 'Detected Rust project (Cargo.toml found)');
      const config = this.languageConfigs.get('rust')!;
      return { ...config, rootPath };
    }

    // Check for Go project files
    if (existsSync(join(rootPath, 'go.mod'))) {
      logger.info({ rootPath }, 'Detected Go project (go.mod found)');
      const config = this.languageConfigs.get('go')!;
      return { ...config, rootPath };
    }

    // Check for C# project files
    const csharpFiles = ['.csproj', '.sln', '.fsproj', '.vbproj'];
    for (const extension of csharpFiles) {
      try {
        const hasCSharpProject = readdirSync(rootPath).some((file) => file.endsWith(extension));
        if (hasCSharpProject) {
          logger.info({ rootPath, extension }, 'Detected C# project');
          const config = this.languageConfigs.get('csharp')!;
          return { ...config, rootPath };
        }
      } catch (e) {
        logger.warn({ error: e, rootPath }, 'Failed to read directory for C# files');
      }
    }

    // Check for Java project files
    const javaProjectFiles = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
    for (const file of javaProjectFiles) {
      if (existsSync(join(rootPath, file))) {
        logger.info({ rootPath, file }, 'Detected Java project');
        const config = this.languageConfigs.get('java')!;
        return { ...config, rootPath };
      }
    }

    // Check for Kotlin project files (often alongside Java)
    if (
      existsSync(join(rootPath, 'build.gradle.kts')) ||
      existsSync(join(rootPath, 'settings.gradle.kts'))
    ) {
      logger.info({ rootPath }, 'Detected Kotlin project');
      const config = this.languageConfigs.get('kotlin')!;
      return { ...config, rootPath };
    }

    // Check for Swift project files
    if (existsSync(join(rootPath, 'Package.swift')) || existsSync(join(rootPath, '.swiftpm'))) {
      logger.info({ rootPath }, 'Detected Swift project');
      const config = this.languageConfigs.get('swift')!;
      return { ...config, rootPath };
    }

    // Check for C/C++ project files
    const cppProjectFiles = [
      'CMakeLists.txt',
      'Makefile',
      '.clang-format',
      'compile_commands.json',
    ];
    for (const file of cppProjectFiles) {
      if (existsSync(join(rootPath, file))) {
        logger.info({ rootPath, file }, 'Detected C/C++ project');
        // Default to C++ as it's more common and clangd handles both
        const config = this.languageConfigs.get('cpp')!;
        return { ...config, rootPath };
      }
    }

    // Check for Ruby project files
    const rubyFiles = ['Gemfile', 'Rakefile', '.ruby-version', '.rvmrc'];
    for (const file of rubyFiles) {
      if (existsSync(join(rootPath, file))) {
        logger.info({ rootPath, file }, 'Detected Ruby project');
        const config = this.languageConfigs.get('ruby')!;
        return { ...config, rootPath };
      }
    }

    // Check for PHP project files
    const phpFiles = ['composer.json', 'composer.lock', '.php-version'];
    for (const file of phpFiles) {
      if (existsSync(join(rootPath, file))) {
        logger.info({ rootPath, file }, 'Detected PHP project');
        const config = this.languageConfigs.get('php')!;
        return { ...config, rootPath };
      }
    }

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
      hasPyFiles = readdirSync(rootPath).some((file) => extname(file) === '.py');
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
