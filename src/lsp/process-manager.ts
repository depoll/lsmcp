import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { LanguageServerConfig } from '../types/lsp.js';
import { ConnectionError, ServerCrashError } from '../utils/errors.js';
import pino from 'pino';

export interface ProcessStreams {
  reader: Readable;
  writer: Writable;
}

export class ProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private logger = pino({ level: 'info' });

  constructor(
    private readonly config: LanguageServerConfig,
    private readonly startTimeout: number = 30000
  ) {
    super();
  }

  async start(): Promise<ProcessStreams> {
    if (this.process) {
      throw new Error('Process already started');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new ConnectionError(`Language server failed to start within ${this.startTimeout}ms`)
        );
      }, this.startTimeout);
      timeout.unref();

      // Container environment doesn't need shell resolution
      const spawnOptions = {
        stdio: 'pipe' as const,
        shell: false,
      };

      this.process = spawn(this.config.command, this.config.args, spawnOptions);

      this.process.once('spawn', () => {
        clearTimeout(timeout);
        this.logger.info(`Process spawned successfully: PID=${this.process!.pid}`);

        if (!this.process!.stdin || !this.process!.stdout) {
          reject(new ConnectionError('Process streams not available'));
          return;
        }

        resolve({
          reader: this.process!.stdout,
          writer: this.process!.stdin,
        });
      });

      this.process.once('error', (error) => {
        clearTimeout(timeout);
        this.logger.error(
          {
            error,
            command: this.config.command,
            args: this.config.args,
            platform: process.platform,
          },
          'Process spawn error'
        );
        reject(
          new ConnectionError(`Failed to spawn process "${this.config.command}": ${error.message}`)
        );
      });

      this.process.on('exit', (code, signal) => {
        this.logger.warn(
          `Process exited: code=${code}, signal=${signal}, PID=${this.process?.pid}`
        );
        this.emit('exit', code, signal);

        // Only emit crash if it's an unexpected termination
        // SIGTERM during shutdown is expected, not a crash
        if ((code !== 0 && code !== null) || (signal && signal !== 'SIGTERM')) {
          this.emit('crash', new ServerCrashError('Language server crashed', code, signal));
        }
      });

      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          const message = data.toString();
          this.logger.error(`Process stderr: ${message}`);
          this.emit('stderr', message);
        });
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    const process = this.process;
    this.process = null;

    // Kill the process
    process.kill('SIGTERM');

    // Wait for process to exit (with timeout)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running
        if (!process.killed) {
          process.kill('SIGKILL');
        }
        resolve();
      }, 5000);
      timeout.unref();

      process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getPid(): number | undefined {
    return this.process?.pid;
  }
}
