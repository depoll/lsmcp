/**
 * Diff formatter utility for displaying workspace edit changes
 */

import { WorkspaceEdit, Range } from 'vscode-languageserver-protocol';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

interface DiffEntry {
  file: string;
  changes: {
    type: 'edit' | 'create' | 'rename' | 'delete';
    oldText?: string;
    newText?: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newUri?: string;
  }[];
}

/**
 * Format a workspace edit as a human-readable diff
 */
export function formatWorkspaceEditAsDiff(edit: WorkspaceEdit): string {
  const diffs: DiffEntry[] = [];

  // Process document changes
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('textDocument' in change) {
        // Text document edit
        const uri = change.textDocument.uri;
        const filePath = getRelativePath(uri);

        const entry: DiffEntry = {
          file: filePath,
          changes: change.edits.map((edit) => ({
            type: 'edit' as const,
            oldText: getOriginalText(uri, edit.range),
            newText: edit.newText,
            range: edit.range,
          })),
        };
        diffs.push(entry);
      } else if ('kind' in change) {
        // File operation
        if (change.kind === 'create') {
          const createOp = change;
          diffs.push({
            file: getRelativePath(createOp.uri),
            changes: [{ type: 'create', newText: '' }],
          });
        } else if (change.kind === 'rename') {
          const renameOp = change;
          diffs.push({
            file: getRelativePath(renameOp.oldUri),
            changes: [
              {
                type: 'rename',
                newUri: getRelativePath(renameOp.newUri),
              },
            ],
          });
        } else if (change.kind === 'delete') {
          const deleteOp = change;
          diffs.push({
            file: getRelativePath(deleteOp.uri),
            changes: [{ type: 'delete' }],
          });
        }
      }
    }
  }

  // Process changes map (legacy format)
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = getRelativePath(uri);
      const entry: DiffEntry = {
        file: filePath,
        changes: edits.map((edit) => ({
          type: 'edit' as const,
          oldText: getOriginalText(uri, edit.range),
          newText: edit.newText,
          range: edit.range,
        })),
      };
      diffs.push(entry);
    }
  }

  return formatDiffs(diffs);
}

/**
 * Get the relative path from a file URI
 */
function getRelativePath(uri: string): string {
  try {
    const fullPath = fileURLToPath(uri);
    const cwd = process.cwd();
    return path.relative(cwd, fullPath) || fullPath;
  } catch {
    // Fallback to just the URI if conversion fails
    return uri;
  }
}

/**
 * Try to get the original text from a file at the specified range
 */
function getOriginalText(uri: string, range: Range | undefined): string {
  try {
    const filePath = fileURLToPath(uri);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (!range) return '';

    const startLine = range.start.line;
    const endLine = range.end.line;
    const startChar = range.start.character;
    const endChar = range.end.character;

    if (startLine === endLine) {
      // Single line edit
      const line = lines[startLine] || '';
      return line.substring(startChar, endChar);
    } else {
      // Multi-line edit
      const result: string[] = [];
      for (let i = startLine; i <= endLine && i < lines.length; i++) {
        const line = lines[i] || '';
        if (i === startLine) {
          result.push(line.substring(startChar));
        } else if (i === endLine) {
          result.push(line.substring(0, endChar));
        } else {
          result.push(line);
        }
      }
      return result.join('\n');
    }
  } catch {
    // If we can't read the file, return a placeholder
    return '<original text>';
  }
}

/**
 * Format the diff entries into a readable string
 */
function formatDiffs(diffs: DiffEntry[]): string {
  const output: string[] = [];

  for (const diff of diffs) {
    output.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    output.push(`File: ${diff.file}`);
    output.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    for (const change of diff.changes) {
      if (change.type === 'create') {
        output.push(`\n✅ Created new file`);
      } else if (change.type === 'delete') {
        output.push(`\n❌ Deleted file`);
      } else if (change.type === 'rename') {
        output.push(`\n📝 Renamed to: ${change.newUri}`);
      } else if (change.type === 'edit') {
        if (change.range) {
          const startLine = change.range.start.line + 1; // Convert to 1-indexed
          const endLine = change.range.end.line + 1;

          if (startLine === endLine) {
            output.push(`\n@ Line ${startLine}`);
          } else {
            output.push(`\n@ Lines ${startLine}-${endLine}`);
          }

          // Show the diff
          if (change.oldText && change.oldText.trim()) {
            output.push(
              '- ' +
                change.oldText
                  .split('\n')
                  .map((line, i) => (i === 0 ? line : '  ' + line))
                  .join('\n')
            );
          }

          if (change.newText && change.newText.trim()) {
            output.push(
              '+ ' +
                change.newText
                  .split('\n')
                  .map((line, i) => (i === 0 ? line : '  ' + line))
                  .join('\n')
            );
          } else if (!change.newText) {
            output.push('  <deleted>');
          }
        }
      }
    }
  }

  if (output.length === 0) {
    return 'No changes to display';
  }

  return output.join('\n');
}

/**
 * Format a simple summary of changes
 */
export function formatWorkspaceEditSummary(edit: WorkspaceEdit): string {
  let fileCount = 0;
  let editCount = 0;
  let createCount = 0;
  let deleteCount = 0;
  let renameCount = 0;

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('textDocument' in change) {
        fileCount++;
        editCount += change.edits.length;
      } else if ('kind' in change) {
        if (change.kind === 'create') createCount++;
        else if (change.kind === 'delete') deleteCount++;
        else if (change.kind === 'rename') renameCount++;
      }
    }
  }

  if (edit.changes) {
    for (const edits of Object.values(edit.changes)) {
      fileCount++;
      editCount += edits.length;
    }
  }

  const parts: string[] = [];
  if (editCount > 0)
    parts.push(
      `${editCount} edit${editCount !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}`
    );
  if (createCount > 0) parts.push(`${createCount} file${createCount !== 1 ? 's' : ''} created`);
  if (deleteCount > 0) parts.push(`${deleteCount} file${deleteCount !== 1 ? 's' : ''} deleted`);
  if (renameCount > 0) parts.push(`${renameCount} file${renameCount !== 1 ? 's' : ''} renamed`);

  return parts.length > 0 ? parts.join(', ') : 'No changes';
}
