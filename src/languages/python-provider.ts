import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { BaseLanguageServerProvider } from './base-provider.js';

export class PythonLanguageServerProvider extends BaseLanguageServerProvider {
  private pythonPath: string | null = null;
  private venvPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      // First detect Python and virtual environment
      await this.detectPythonEnvironment();

      if (!this.pythonPath) {
        logger.error('No Python interpreter found');
        return false;
      }

      // Check if pylsp is available
      const result = await this.executeCommand([this.pythonPath, '-m', 'pylsp', '--version']);
      logger.info(
        { version: result, pythonPath: this.pythonPath },
        'Python language server is available'
      );
      return true;
    } catch (error) {
      logger.debug({ error }, 'Python language server not found');

      // Try checking if it's installed as a package
      try {
        const result = await this.executeCommand([
          this.pythonPath || 'python3',
          '-c',
          'import pylsp_server; print(pylsp_server.__version__)',
        ]);
        logger.info({ version: result }, 'Python LSP server package found');
        return true;
      } catch {
        logger.error('Python language server not found');
        return false;
      }
    }
  }

  async install(options?: { force?: boolean }): Promise<void> {
    if (this.isContainer) {
      logger.info('Running in container - language servers should be pre-installed');
      throw this.getContainerInstallError('python-lsp-server');
    }

    if (!options?.force) {
      throw this.getForceInstallError();
    }

    // Detect Python environment if not already done
    if (!this.pythonPath) {
      await this.detectPythonEnvironment();
    }

    if (!this.pythonPath) {
      throw new Error('No Python interpreter found. Please install Python 3.');
    }

    logger.info('Installing python-lsp-server...');

    try {
      // Install with all optional dependencies for best experience
      await this.executeCommand([
        this.pythonPath,
        '-m',
        'pip',
        'install',
        '--upgrade',
        'python-lsp-server[all]',
      ]);
      logger.info('Python language server installed successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to install Python language server');

      // Try minimal installation
      try {
        logger.info('Trying minimal installation without optional dependencies...');
        await this.executeCommand([
          this.pythonPath,
          '-m',
          'pip',
          'install',
          '--upgrade',
          'python-lsp-server',
        ]);
        logger.info('Python language server installed successfully (minimal)');
      } catch {
        throw this.getManualInstallError('python-lsp-server', 'pip install python-lsp-server[all]');
      }
    }
  }

  getCommand(): string[] {
    // Use detected Python path or fall back to configured command
    if (this.pythonPath) {
      return [this.pythonPath, '-m', 'pylsp'];
    }
    return this.language.serverCommand;
  }

  private async detectPythonEnvironment(): Promise<void> {
    const rootPath = this.language.rootPath || process.cwd();

    // Check for virtual environments
    const venvPaths = [
      join(rootPath, 'venv'),
      join(rootPath, '.venv'),
      join(rootPath, 'env'),
      join(rootPath, '.env'),
    ];

    for (const venvPath of venvPaths) {
      const pythonBin = this.getPythonBinPath(venvPath);
      if (pythonBin && existsSync(pythonBin)) {
        this.venvPath = venvPath;
        this.pythonPath = pythonBin;
        logger.info({ venvPath, pythonPath: pythonBin }, 'Found virtual environment');
        return;
      }
    }

    // Check for Poetry environment
    try {
      const poetryEnv = await this.executeCommand(['poetry', 'env', 'info', '--path'], 5000);
      if (poetryEnv) {
        const pythonBin = this.getPythonBinPath(poetryEnv.trim());
        if (pythonBin && existsSync(pythonBin)) {
          this.venvPath = poetryEnv.trim();
          this.pythonPath = pythonBin;
          logger.info(
            { venvPath: this.venvPath, pythonPath: pythonBin },
            'Found Poetry environment'
          );
          return;
        }
      }
    } catch {
      logger.debug('Poetry not found or no Poetry environment');
    }

    // Check for Pipenv
    try {
      const pipenvPython = await this.executeCommand(['pipenv', '--py'], 5000);
      if (pipenvPython) {
        this.pythonPath = pipenvPython.trim();
        logger.info({ pythonPath: this.pythonPath }, 'Found Pipenv Python');
        return;
      }
    } catch {
      logger.debug('Pipenv not found or no Pipenv environment');
    }

    // Check for Conda environment
    if (process.env['CONDA_DEFAULT_ENV']) {
      try {
        const condaPython = await this.executeCommand(['conda', 'run', 'which', 'python'], 5000);
        if (condaPython) {
          this.pythonPath = condaPython.trim();
          logger.info(
            { pythonPath: this.pythonPath, condaEnv: process.env['CONDA_DEFAULT_ENV'] },
            'Found Conda environment'
          );
          return;
        }
      } catch {
        logger.debug('Conda not available');
      }
    }

    // Fall back to system Python
    const pythonCommands = ['python3', 'python'];
    for (const cmd of pythonCommands) {
      try {
        const version = await this.executeCommand([cmd, '--version'], 5000);
        if (version && version.includes('Python')) {
          this.pythonPath = cmd;
          logger.info({ pythonPath: cmd, version }, 'Using system Python');
          return;
        }
      } catch {
        continue;
      }
    }

    logger.warn('No Python interpreter found');
  }

  private getPythonBinPath(venvPath: string): string | null {
    // Check for Windows and Unix-style paths
    const candidates = [
      join(venvPath, 'bin', 'python'),
      join(venvPath, 'bin', 'python3'),
      join(venvPath, 'Scripts', 'python.exe'),
      join(venvPath, 'Scripts', 'python3.exe'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
