import { resolve, normalize, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

/**
 * Security utilities for validating file paths and preventing path traversal attacks
 */

/**
 * Validates that a file path is within the allowed workspace boundaries
 * @param filePath The file path to validate (can be a file:// URI or regular path)
 * @param workspaceRoot The root directory that files must be within
 * @returns The normalized absolute path if valid
 * @throws Error if the path attempts to traverse outside the workspace
 */
export function validateFilePath(filePath: string, workspaceRoot: string): string {
  // Convert file:// URI to path if needed
  let normalizedPath = filePath;
  if (filePath.startsWith('file://')) {
    normalizedPath = fileURLToPath(filePath);
  }

  // Resolve to absolute path
  const absolutePath = isAbsolute(normalizedPath)
    ? normalize(normalizedPath)
    : resolve(workspaceRoot, normalizedPath);

  // Resolve the workspace root to absolute path
  const absoluteWorkspace = resolve(workspaceRoot);

  // Check if the resolved path is within the workspace
  if (!absolutePath.startsWith(absoluteWorkspace)) {
    throw new Error(
      `Path traversal attempt detected: ${filePath} would access outside workspace ${workspaceRoot}`
    );
  }

  // Additional checks for suspicious patterns
  const suspiciousPatterns = [
    /\.\.[\\/]/, // Parent directory traversal
    /^\//, // Absolute paths on Unix that might escape
    /^[A-Za-z]:[\\/]/, // Absolute paths on Windows
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/, // Control characters
  ];

  // Only check the relative part for suspicious patterns
  const relativePath = absolutePath.substring(absoluteWorkspace.length);
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(relativePath)) {
      throw new Error(`Suspicious path pattern detected: ${filePath}`);
    }
  }

  return absolutePath;
}

/**
 * Validates glob patterns to prevent malicious patterns
 * @param pattern The glob pattern to validate
 * @throws Error if the pattern contains dangerous elements
 */
export function validateGlobPattern(pattern: string): void {
  // Disallow patterns that could match system files
  const dangerousPatterns = [
    /^\//, // Absolute paths
    /^[A-Za-z]:/, // Windows absolute paths
    /\.\.[/\\]/, // Parent directory traversal
    /^\*\*$/, // Match everything recursively
    /^\/\*\*/, // Match from root
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      throw new Error(`Dangerous glob pattern detected: ${pattern}`);
    }
  }

  // Limit pattern complexity to prevent ReDoS
  if (pattern.length > 1000) {
    throw new Error('Glob pattern too long');
  }

  // Count wildcards to prevent excessive matching
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  if (wildcardCount > 10) {
    throw new Error('Too many wildcards in glob pattern');
  }
}

/**
 * Sanitizes a file URI to ensure it's safe to use
 * @param uri The URI to sanitize
 * @returns The sanitized URI
 */
export function sanitizeFileURI(uri: string): string {
  // Remove any null bytes or control characters
  // eslint-disable-next-line no-control-regex
  let sanitized = uri.replace(/[\x00-\x1f]/g, '');

  // Ensure it's a proper file:// URI
  if (!sanitized.startsWith('file://')) {
    throw new Error('Invalid file URI: must start with file://');
  }

  // Decode any encoded sequences to check for traversal
  try {
    const decoded = decodeURIComponent(sanitized);
    if (decoded.includes('../') || decoded.includes('..\\')) {
      throw new Error('Path traversal detected in URI');
    }
  } catch {
    throw new Error('Invalid URI encoding');
  }

  return sanitized;
}
