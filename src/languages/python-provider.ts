import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { join } from 'path';
import { DetectedLanguage } from './detector.js';
import { logger } from '../utils/logger.js';
import type { LanguageServerProvider } from './typescript-provider.js';

export class PythonLanguageServerProvider implements LanguageServerProvider {
  private isContainer: boolean;
  private pythonPath: string | null = null;
  private venvPath: string | null = null;

  constructor(public readonly language: DetectedLanguage) {
    this.isContainer = this.detectContainer();
  }

  private detectContainer(): boolean {
    return (
      process.env['CONTAINER'] === 'true' ||
      process.env['DOCKER'] === 'true' ||
      existsSync('/.dockerenv')
    );
  }

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
      throw new Error(
        'Language server installation in containers is not supported. ' +
          'The python-lsp-server should be pre-installed in the container image.'
      );
    }

    if (!options?.force) {
      throw new Error(
        'Auto-installation requires explicit user consent. Pass { force: true } to confirm installation.'
      );
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
        throw new Error(
          'Failed to install python-lsp-server. ' +
            'Please install it manually: pip install python-lsp-server[all]'
        );
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

  private executeCommand(command: string[], timeout = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (command.length === 0) {
        reject(new Error('Command array is empty'));
        return;
      }

      const [cmd, ...args] = command;
      if (!cmd) {
        reject(new Error('Command is undefined'));
        return;
      }

      let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
      try {
        child = spawn(cmd, args, {
          cwd: this.language.rootPath || process.cwd(),
          env: {
            ...process.env,
            // Ensure virtual environment is activated
            ...(this.venvPath ? { VIRTUAL_ENV: this.venvPath } : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to spawn ${cmd}: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (child) {
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
          killTimer.unref();
        }
      }, timeout);
      timer.unref();

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeout}ms: ${command.join(' ')}`));
        } else if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMessage = stderr || `Command failed with code ${code}`;
          reject(new Error(`${cmd} failed: ${errorMessage}`));
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to execute ${cmd}: ${error.message}`));
      });
    });
  }
}
