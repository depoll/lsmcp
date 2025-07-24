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
    const filePath = fileURLToPath(uri);
    // Use path.extname for cross-platform compatibility
    const lastDot = filePath.lastIndexOf('.');
    const ext = lastDot > 0 ? filePath.slice(lastDot + 1).toLowerCase() : '';
    return LANGUAGE_EXTENSIONS[ext] || 'plaintext';
  } catch {
    // Fallback for invalid URIs
    return 'plaintext';
  }
}
