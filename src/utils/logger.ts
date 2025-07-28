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
 * Container environment uses Unix-style paths
 */
export function pathToFileUri(path: string): string {
  if (path.startsWith('file://')) {
    return path;
  }

  // Unix-style paths - ensure we have exactly three slashes for absolute paths
  if (path.startsWith('/')) {
    return `file://${path}`;
  } else {
    return `file:///${path}`;
  }
}

/**
 * Normalize a file URI for comparison
 * Container environment uses case-sensitive Unix-style paths
 */
export function normalizeUri(uri: string): string {
  return uri;
}
