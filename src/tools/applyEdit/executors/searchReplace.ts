import { WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import type { ApplyEditParams } from '../schemas.js';
import { readFile } from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { validateFilePath, validateGlobPattern } from '../../../utils/path-security.js';
import { logger as baseLogger } from '../../../utils/logger.js';

const logger = baseLogger.child({ component: 'ApplyEditTool.searchReplace' });

export async function executeSearchReplace(params: ApplyEditParams): Promise<WorkspaceEdit[]> {
  if (!params.searchReplace) {
    throw new Error('No search replace parameters specified');
  }

  const {
    pattern,
    replacement,
    scope,
    uri,
    filePattern,
    excludePatterns,
    caseSensitive,
    wholeWord,
  } = params.searchReplace;

  // Validate glob pattern if provided
  if (filePattern) {
    validateGlobPattern(filePattern);
  }

  // Create regex from pattern
  let regex: RegExp;
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    // Parse regex pattern
    const lastSlash = pattern.lastIndexOf('/');
    const regexPattern = pattern.substring(1, lastSlash);
    const flags = pattern.substring(lastSlash + 1);
    regex = new RegExp(regexPattern, flags);
  } else {
    // Create literal pattern regex
    let escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
      escapedPattern = `\\b${escapedPattern}\\b`;
    }
    regex = new RegExp(escapedPattern, caseSensitive ? 'g' : 'gi');
  }

  // Find files to search
  let filesToSearch: string[] = [];
  switch (scope) {
    case 'file': {
      if (!uri) throw new Error('URI required for file scope');
      const filePath = fileURLToPath(uri);
      validateFilePath(filePath, process.cwd());
      filesToSearch = [filePath];
      break;
    }

    case 'directory':
    case 'workspace': {
      const baseDir = uri ? fileURLToPath(uri) : process.cwd();

      // Validate base directory
      validateFilePath(baseDir, process.cwd());

      const globPattern = filePattern || '**/*';
      const fullPattern = path.join(baseDir, globPattern);
      filesToSearch = await glob(fullPattern, {
        ignore: excludePatterns || [],
        nodir: true,
      });
      break;
    }
  }

  // Apply replacements
  const edits: WorkspaceEdit[] = [];
  let totalReplacements = 0;
  const maxReplacements = params.searchReplace.maxReplacements || 1000;

  for (const filePath of filesToSearch) {
    try {
      // Validate each file path before processing
      validateFilePath(filePath, process.cwd());

      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const fileEdits: TextEdit[] = [];

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match: RegExpExecArray | null;
        const lineRegex = new RegExp(regex.source, regex.flags.replace('g', ''));

        while ((match = regex.exec(line || '')) !== null) {
          if (totalReplacements >= maxReplacements) {
            throw new Error(`Maximum replacements limit (${maxReplacements}) reached`);
          }

          const startChar = match.index;
          const endChar = match.index + match[0].length;
          const newText = match[0].replace(lineRegex, replacement);

          fileEdits.push({
            range: {
              start: { line: lineIndex, character: startChar },
              end: { line: lineIndex, character: endChar },
            },
            newText,
          });

          totalReplacements++;

          // Prevent infinite loop for zero-width matches
          if (match[0].length === 0) {
            regex.lastIndex++;
          }
        }
      }

      if (fileEdits.length > 0) {
        const workspaceEdit: WorkspaceEdit = {
          documentChanges: [
            {
              textDocument: { uri: `file://${filePath}`, version: null },
              edits: fileEdits,
            },
          ],
        };
        edits.push(workspaceEdit);
      }
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to process file');
    }
  }

  return edits;
}
