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

      this.process = spawn(this.config.command, this.config.args, {
        stdio: 'pipe',
        shell: false,
      });

      this.process.once('spawn', () => {
        clearTimeout(timeout);

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
        this.logger.error('Process spawn error:', error);
        reject(new ConnectionError(`Failed to spawn process: ${error.message}`));
      });

      this.process.on('exit', (code, signal) => {
        this.logger.warn(`Process exited: code=${code}, signal=${signal}`);
        this.emit('exit', code, signal);

        if (code !== 0 || signal) {
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

  stop(): void {
    if (!this.process) {
      return;
    }

    this.process.kill('SIGTERM');
    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getPid(): number | undefined {
    return this.process?.pid;
  }
}
