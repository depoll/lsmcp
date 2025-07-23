export class LSPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly language?: string,
    public readonly workspace?: string
  ) {
    super(message);
    this.name = 'LSPError';
  }
}

export class ConnectionError extends LSPError {
  constructor(message: string, language?: string, workspace?: string) {
    super(message, 'CONNECTION_ERROR', language, workspace);
    this.name = 'ConnectionError';
  }
}

export class ServerCrashError extends LSPError {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly signal: string | null,
    language?: string,
    workspace?: string
  ) {
    super(message, 'SERVER_CRASH', language, workspace);
    this.name = 'ServerCrashError';
  }
}

export class TimeoutError extends LSPError {
  constructor(message: string, language?: string, workspace?: string) {
    super(message, 'TIMEOUT', language, workspace);
    this.name = 'TimeoutError';
  }
}

export function isRecoverableError(error: unknown): boolean {
  if (error instanceof ServerCrashError) {
    return true;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  if (error instanceof Error && error.message.includes('ECONNRESET')) {
    return true;
  }
  return false;
}
