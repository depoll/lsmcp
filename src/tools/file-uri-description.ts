/**
 * Shared file URI descriptions for consistent documentation across all MCP tools.
 *
 * Optimized for token efficiency while maintaining clarity.
 * Detailed examples and platform-specific notes are available in FILE_URI_EXAMPLES.
 */

/**
 * Detailed file URI examples and platform notes
 */
export const FILE_URI_EXAMPLES = {
  linux: 'file:///home/user/project/src/index.ts',
  mac: 'file:///Users/name/project/src/index.ts',
  windowsNative: 'file:///C:/Users/Name/project/src/index.ts',
  windowsContainer: 'file:///mnt/c/Users/Name/project/src/index.ts',
  windowsContainerAlt: 'file:///c/Users/Name/project/src/index.ts',
  withSpaces: 'file:///path/with%20spaces/file.ts',
  containerNotes: {
    mounting: 'Container mounts workspace at same path (${PWD}:${PWD})',
    linuxMac: 'Paths preserved as-is',
    windows: 'C:\\ becomes /mnt/c/ (WSL2) or /c/ (other Docker configs)',
  },
};

/**
 * Standard file URI description for most operations
 */
export const FILE_URI_DESCRIPTION =
  'Valid file:// URI with percent-encoding. ' +
  'Container paths: Linux/Mac preserved, Windows C:\\ becomes /mnt/c/ or /c/. ' +
  'Example: file:///home/user/project/src/file.ts';

/**
 * File URI description for navigation operations
 */
export const NAVIGATION_FILE_URI_DESCRIPTION =
  'File URI containing symbol. Valid file:// with percent-encoding. ' +
  'Container: Windows paths become Linux-style.';

/**
 * File URI description for document-scoped operations
 */
export const DOCUMENT_SCOPE_URI_DESCRIPTION =
  'File URI for document scope. Required when scope="document". ' +
  'Valid file:// URI. Container: Use Linux-style paths.';

/**
 * File URI description for batch operations
 */
export const BATCH_FILE_URI_DESCRIPTION =
  'File URI with symbol. Valid file:// URL. Container: Linux-style paths.';

/**
 * Get container path information for display in tool descriptions
 */
export function getContainerPathInfo(): string {
  // Check if we're running in a container
  const isContainer =
    process.env['CONTAINER'] === 'true' ||
    !!process.env['KUBERNETES_SERVICE_HOST'] ||
    process.env['DOCKER_CONTAINER'] === 'true';

  if (isContainer) {
    const workdir = process.cwd();
    const platform = process.platform;

    // Provide platform-specific guidance
    if (platform === 'win32') {
      return (
        `Container working directory: ${workdir}. ` +
        'Windows paths are converted to Linux format in the container. ' +
        'Use /mnt/c/ or /c/ instead of C:\\ for Windows drives.'
      );
    }

    return (
      `Container working directory: ${workdir}. ` +
      'Files are accessed relative to the mounted workspace.'
    );
  }

  return 'Running in native mode (not containerized).';
}

/**
 * Convert a Windows path to container path format
 * @param windowsPath - Path like C:\Users\Name\project
 * @returns Container path like /mnt/c/Users/Name/project
 */
export function windowsToContainerPath(windowsPath: string): string {
  // Handle different Docker Desktop configurations
  // WSL2 backend typically uses /mnt/c, others might use /c
  const converted = windowsPath
    .replace(/^([A-Z]):\\/i, (_match, drive: string) => {
      // Try /mnt/c style first (WSL2), fallback to /c style
      const driveLetter = drive.toLowerCase();
      return process.env['WSL_DISTRO_NAME'] ? `/mnt/${driveLetter}/` : `/${driveLetter}/`;
    })
    .replace(/\\/g, '/');

  return `file://${converted}`;
}
