import pino from 'pino';

// Configure logger based on environment
const isTest = process.env['NODE_ENV'] === 'test';

export const logger = isTest
  ? pino({
      name: 'lsmcp',
      level: 'silent', // Disable logging in tests
    })
  : pino({
      name: 'lsmcp',
      level: process.env['LOG_LEVEL'] || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss.l',
        },
      },
    });

/**
 * Convert a filesystem path to a proper file:// URI
 * Handles Windows paths correctly
 */
export function pathToFileUri(path: string): string {
  if (path.startsWith('file://')) {
    return path;
  }

  // Handle Windows paths
  if (process.platform === 'win32') {
    return `file:///${path.replace(/\\/g, '/')}`;
  }

  // Unix-like paths
  return `file://${path}`;
}
