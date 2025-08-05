import { WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import type { ApplyEditParams } from '../schemas.js';
import { logger as baseLogger } from '../../../utils/logger.js';

const logger = baseLogger.child({ component: 'ApplyEditTool.smartInsert' });

export async function executeSmartInsert(
  params: ApplyEditParams,
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string>
): Promise<WorkspaceEdit[]> {
  if (!params.smartInsert) {
    throw new Error('No smart insert parameters specified');
  }

  const { uri, insertions } = params.smartInsert;
  const filePath = new URL(uri).pathname;
  const content = await readFileFn(filePath, 'utf-8');
  const lines = content.split('\n');
  const edits: TextEdit[] = [];

  for (const insertion of insertions) {
    switch (insertion.type) {
      case 'import': {
        const importEdit = createImportEdit(lines, insertion.content, insertion.sortOrder);
        if (importEdit) edits.push(importEdit);
        break;
      }
      case 'method':
      case 'property': {
        if (!insertion.className) {
          throw new Error(`Class name required for ${insertion.type} insertion`);
        }
        const classEdit = createClassMemberEdit(
          lines,
          insertion.className,
          insertion.content,
          insertion.type,
          insertion.preferredLocation
        );
        if (classEdit) edits.push(classEdit);
        break;
      }
      case 'comment': {
        const commentEdit = createCommentEdit(lines, insertion.content, insertion.preferredLocation);
        if (commentEdit) edits.push(commentEdit);
        break;
      }
    }
  }

  if (edits.length > 0) {
    const workspaceEdit: WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: { uri, version: null },
          edits,
        },
      ],
    };
    return [workspaceEdit];
  }

  return [];
}

function createImportEdit(
  lines: string[],
  importStatement: string,
  sortOrder?: 'alphabetical' | 'dependency' | 'none'
): TextEdit | null {
  // Find existing imports
  let firstImportLine = -1;
  let lastImportLine = -1;
  const imports: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('const ') && line.includes('require')) {
      if (firstImportLine === -1) firstImportLine = i;
      lastImportLine = i;
      imports.push({ line: i, text: lines[i] });
    } else if (firstImportLine !== -1 && line && !line.startsWith('//')) {
      // Stop when we hit non-import, non-comment, non-empty line
      break;
    }
  }

  // Determine insertion position
  let insertLine = 0;
  if (firstImportLine !== -1) {
    insertLine = lastImportLine + 1;
  }

  // Add the import
  const newText = importStatement + '\n';

  return {
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    newText,
  };
}

function createClassMemberEdit(
  lines: string[],
  className: string,
  content: string,
  type: 'method' | 'property',
  preferredLocation?: 'top' | 'bottom' | 'beforeClass' | 'afterImports' | 'insideClass'
): TextEdit | null {
  // Find the class
  let classStartLine = -1;
  let classEndLine = -1;
  let braceCount = 0;
  let foundClass = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`class ${className}`) || line.includes(`export class ${className}`)) {
      classStartLine = i;
      foundClass = true;
    }

    if (foundClass) {
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }

      if (braceCount === 0 && classStartLine !== -1) {
        classEndLine = i;
        break;
      }
    }
  }

  if (classStartLine === -1 || classEndLine === -1) {
    logger.warn({ className }, 'Class not found');
    return null;
  }

  // Find insertion point
  let insertLine = classEndLine;
  if (preferredLocation === 'top' || preferredLocation === 'insideClass') {
    // Insert after the opening brace
    for (let i = classStartLine; i <= classEndLine; i++) {
      if (lines[i].includes('{')) {
        insertLine = i + 1;
        break;
      }
    }
  }

  // Determine indentation
  const classIndent = lines[classStartLine].match(/^\s*/)?.[0] || '';
  const memberIndent = classIndent + '  ';

  return {
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    newText: memberIndent + content + '\n',
  };
}

function createCommentEdit(
  lines: string[],
  comment: string,
  preferredLocation?: 'top' | 'bottom' | 'beforeClass' | 'afterImports' | 'insideClass'
): TextEdit | null {
  let insertLine = 0;

  switch (preferredLocation) {
    case 'top':
      insertLine = 0;
      break;
    case 'bottom':
      insertLine = lines.length;
      break;
    case 'afterImports': {
      // Find last import
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('import ') || line.startsWith('from ')) {
          insertLine = i + 1;
        }
      }
      break;
    }
    default:
      insertLine = 0;
  }

  return {
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    newText: comment + '\n',
  };
}