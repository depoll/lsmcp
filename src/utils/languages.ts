/**
 * Language detection utilities for LSP
 */

import { fileURLToPath } from 'url';

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  r: 'r',
  lua: 'lua',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
};

/**
 * Get language ID from file URI
 */
export function getLanguageFromUri(uri: string): string {
  try {
    // First try to extract extension from URI directly (for test compatibility)
    const uriLastDot = uri.lastIndexOf('.');
    if (uriLastDot > 0) {
      const uriExt = uri.slice(uriLastDot + 1).toLowerCase();
      if (LANGUAGE_EXTENSIONS[uriExt]) {
        return LANGUAGE_EXTENSIONS[uriExt];
      }
    }

    // Then try proper file path conversion
    const filePath = fileURLToPath(uri);
    const lastDot = filePath.lastIndexOf('.');
    const ext = lastDot > 0 ? filePath.slice(lastDot + 1).toLowerCase() : '';
    return LANGUAGE_EXTENSIONS[ext] || 'plaintext';
  } catch {
    // Fallback for invalid URIs - still try to extract from URI
    const lastDot = uri.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = uri.slice(lastDot + 1).toLowerCase();
      return LANGUAGE_EXTENSIONS[ext] || 'plaintext';
    }
    return 'plaintext';
  }
}
