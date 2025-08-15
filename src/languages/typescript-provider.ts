import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class TypeScriptLanguageServerProvider extends BaseLanguageServerProvider {
  async isAvailable(): Promise<boolean> {
    // Try simple which check first
    if (await this.commandExists('typescript-language-server')) {
      logger.info('TypeScript language server found in PATH');
      return true;
    }

    // Try direct version check
    const version = await this.checkVersion('typescript-language-server');
    if (version) {
      logger.info({ version }, 'TypeScript language server is available');
      return true;
    }

    // Last resort: check if it's installed globally via npm
    try {
      await this.executeCommand(['npm', 'list', '-g', 'typescript-language-server']);
      logger.info('TypeScript language server found via npm list');
      return true;
    } catch {
      logger.debug('TypeScript language server not found via any method');
      return false;
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    // In containers, language servers should already be pre-installed
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('typescript-language-server');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    logger.info('Installing typescript-language-server...');

    // Check for npm or yarn
    const packageManager = await this.detectPackageManager();

    if (packageManager === 'npm') {
      try {
        await this.executeCommand(['npm', 'install', '-g', 'typescript-language-server']);
        logger.info('TypeScript language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install TypeScript language server');
        throw this.getManualInstallError(
          'typescript-language-server',
          'npm install -g typescript-language-server'
        );
      }
    } else if (packageManager === 'yarn') {
      try {
        await this.executeCommand(['yarn', 'global', 'add', 'typescript-language-server']);
        logger.info('TypeScript language server installed successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to install TypeScript language server');
        throw this.getManualInstallError(
          'typescript-language-server',
          'yarn global add typescript-language-server'
        );
      }
    } else {
      throw this.getNoPackageManagerError();
    }
  }
}

export async function createLanguageServerProvider(
  language: DetectedLanguage
): Promise<BaseLanguageServerProvider | null> {
  switch (language.id) {
    case 'typescript':
    case 'javascript':
      return new TypeScriptLanguageServerProvider(language);
    case 'python': {
      // Dynamic import to avoid circular dependency
      const { PythonLanguageServerProvider } = await import('./python-provider.js');
      return new PythonLanguageServerProvider(language);
    }
    case 'rust': {
      const { RustLanguageServerProvider } = await import('./rust-provider.js');
      return new RustLanguageServerProvider(language);
    }
    case 'go': {
      const { GoLanguageServerProvider } = await import('./go-provider.js');
      return new GoLanguageServerProvider(language);
    }
    case 'csharp': {
      const { CSharpLanguageServerProvider } = await import('./csharp-provider.js');
      return new CSharpLanguageServerProvider(language);
    }
    case 'java': {
      const { JavaLanguageServerProvider } = await import('./java-provider.js');
      return new JavaLanguageServerProvider(language);
    }
    case 'c':
    case 'cpp':
    case 'objective-c': {
      const { CppLanguageServerProvider } = await import('./cpp-provider.js');
      return new CppLanguageServerProvider(language);
    }
    case 'bash': {
      const { BashLanguageServerProvider } = await import('./bash-provider.js');
      return new BashLanguageServerProvider(language);
    }
    case 'json':
    case 'jsonc': {
      const { JsonLanguageServerProvider } = await import('./json-provider.js');
      return new JsonLanguageServerProvider(language);
    }
    case 'yaml': {
      const { YamlLanguageServerProvider } = await import('./yaml-provider.js');
      return new YamlLanguageServerProvider(language);
    }
    case 'html': {
      const { HtmlLanguageServerProvider } = await import('./web-provider.js');
      return new HtmlLanguageServerProvider(language);
    }
    case 'css':
    case 'scss':
    case 'sass':
    case 'less': {
      const { CssLanguageServerProvider } = await import('./web-provider.js');
      return new CssLanguageServerProvider(language);
    }
    case 'ruby': {
      const { RubyLanguageServerProvider } = await import('./ruby-provider.js');
      return new RubyLanguageServerProvider(language);
    }
    case 'php': {
      const { PhpLanguageServerProvider } = await import('./php-provider.js');
      return new PhpLanguageServerProvider(language);
    }
    case 'kotlin': {
      const { KotlinLanguageServerProvider } = await import('./kotlin-provider.js');
      return new KotlinLanguageServerProvider(language);
    }
    case 'swift': {
      const { SwiftLanguageServerProvider } = await import('./swift-provider.js');
      return new SwiftLanguageServerProvider(language);
    }
    default:
      return null;
  }
}
