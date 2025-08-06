import { readFile, writeFile, mkdir, unlink, rename, access } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { logger } from './logger.js';

/**
 * Apply text edits to a file
 */
export async function applyTextEdits(uri: string, edits: TextEdit[]): Promise<void> {
  const filePath = fileURLToPath(uri);

  // Read the file content
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // Sort edits in reverse order (bottom to top) to avoid position shifts
  const sortedEdits = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  // Validate no overlapping edits
  for (let i = 0; i < sortedEdits.length - 1; i++) {
    const current = sortedEdits[i];
    const next = sortedEdits[i + 1];

    // These should always be defined due to loop bounds, but TypeScript needs assurance
    if (!current || !next) continue;

    // Since we're sorted in reverse, current should be after next
    // Check if they overlap
    if (
      current.range.end.line < next.range.start.line ||
      (current.range.end.line === next.range.start.line &&
        current.range.end.character <= next.range.start.character)
    ) {
      // No overlap, edits are properly separated
      continue;
    }

    // Edits overlap - this could cause corruption
    throw new Error(
      `Overlapping text edits detected at lines ${next.range.start.line + 1}-${next.range.end.line + 1} ` +
        `and ${current.range.start.line + 1}-${current.range.end.line + 1}. ` +
        `This could cause file corruption.`
    );
  }

  // Apply each edit
  for (const edit of sortedEdits) {
    const startLine = edit.range.start.line;
    const endLine = edit.range.end.line;
    const startChar = edit.range.start.character;
    const endChar = edit.range.end.character;

    // Validate line numbers
    if (startLine < 0 || startLine >= lines.length) {
      throw new Error(`Invalid start line ${startLine + 1}. File has ${lines.length} lines.`);
    }
    if (endLine < 0 || endLine >= lines.length) {
      throw new Error(`Invalid end line ${endLine + 1}. File has ${lines.length} lines.`);
    }

    if (startLine === endLine) {
      // Single line edit
      const line = lines[startLine] || '';

      // Validate character positions
      if (startChar < 0 || startChar > line.length) {
        throw new Error(
          `Invalid start character ${startChar} on line ${startLine + 1}. Line has ${line.length} characters.`
        );
      }
      if (endChar < 0 || endChar > line.length) {
        throw new Error(
          `Invalid end character ${endChar} on line ${startLine + 1}. Line has ${line.length} characters.`
        );
      }

      lines[startLine] = line.substring(0, startChar) + edit.newText + line.substring(endChar);
    } else {
      // Multi-line edit
      const startLineText = lines[startLine] || '';
      const endLineText = lines[endLine] || '';

      // Validate character positions
      if (startChar < 0 || startChar > startLineText.length) {
        throw new Error(
          `Invalid start character ${startChar} on line ${startLine + 1}. Line has ${startLineText.length} characters.`
        );
      }
      if (endChar < 0 || endChar > endLineText.length) {
        throw new Error(
          `Invalid end character ${endChar} on line ${endLine + 1}. Line has ${endLineText.length} characters.`
        );
      }

      const newText =
        startLineText.substring(0, startChar) + edit.newText + endLineText.substring(endChar);

      // Replace the lines
      lines.splice(startLine, endLine - startLine + 1, ...newText.split('\n'));
    }
  }

  // Write the modified content back
  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Create a file with optional content
 */
export async function createFile(uri: string, content?: string): Promise<void> {
  const filePath = fileURLToPath(uri);

  // Ensure directory exists
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  // Write file
  await writeFile(filePath, content || '', 'utf-8');
}

/**
 * Delete a file
 */
export async function deleteFile(uri: string): Promise<void> {
  const filePath = fileURLToPath(uri);
  await unlink(filePath);
}

/**
 * Rename/move a file
 */
export async function renameFile(
  oldUri: string,
  newUri: string,
  options?: {
    overwrite?: boolean;
    ignoreIfExists?: boolean;
  }
): Promise<void> {
  const oldPath = fileURLToPath(oldUri);
  const newPath = fileURLToPath(newUri);

  // Check if target exists
  try {
    await access(newPath);
    // File exists
    if (options?.ignoreIfExists) {
      return;
    }
    if (!options?.overwrite) {
      throw new Error(`Target file already exists: ${newPath}`);
    }
  } catch {
    // File doesn't exist, proceed
  }

  // Ensure target directory exists
  const dir = dirname(newPath);
  await mkdir(dir, { recursive: true });

  // Rename file
  await rename(oldPath, newPath);
}

/**
 * Apply a complete workspace edit
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<{
  applied: boolean;
  failureReason?: string;
  failedChange?: string;
}> {
  try {
    // Handle document changes if present
    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        try {
          if ('textDocument' in change) {
            // Text document edit
            const uri = change.textDocument.uri;
            await applyTextEdits(uri, change.edits);
          } else if ('kind' in change) {
            // Resource operation
            switch (change.kind) {
              case 'create':
                await createFile(change.uri);
                break;
              case 'delete':
                await deleteFile(change.uri);
                break;
              case 'rename':
                await renameFile(change.oldUri, change.newUri, change.options);
                break;
              default:
                logger.warn(
                  `Unknown resource operation kind: ${(change as { kind: string }).kind}`
                );
            }
          }
        } catch (error) {
          const changeDesc =
            'textDocument' in change
              ? `text edit in ${change.textDocument.uri}`
              : `${change.kind} operation`;
          return {
            applied: false,
            failureReason: error instanceof Error ? error.message : String(error),
            failedChange: changeDesc,
          };
        }
      }
    }

    // Handle simple changes (deprecated but still supported)
    if (edit.changes) {
      for (const [uri, edits] of Object.entries(edit.changes)) {
        try {
          await applyTextEdits(uri, edits);
        } catch (error) {
          return {
            applied: false,
            failureReason: error instanceof Error ? error.message : String(error),
            failedChange: `text edit in ${uri}`,
          };
        }
      }
    }

    return { applied: true };
  } catch (error) {
    return {
      applied: false,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}
