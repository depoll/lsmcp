import { access } from 'fs/promises';
import { constants } from 'fs';

/**
 * Detects if running in a container environment
 * Checks environment variables and Docker-specific files
 */
export async function detectContainer(): Promise<boolean> {
  // Check environment variables first (fast)
  if (process.env['CONTAINER'] === 'true' || process.env['DOCKER'] === 'true') {
    return true;
  }

  // Check for /.dockerenv file (most reliable container indicator)
  try {
    await access('/.dockerenv', constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous container detection for use in constructors
 * Only checks environment variables, not filesystem
 */
export function detectContainerSync(): boolean {
  return process.env['CONTAINER'] === 'true' || process.env['DOCKER'] === 'true';
}
