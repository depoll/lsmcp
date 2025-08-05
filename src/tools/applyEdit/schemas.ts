import { z } from 'zod';
import { createPositionSchema } from '../position-schema.js';
import { FILE_URI_DESCRIPTION } from '../file-uri-description.js';

// Sub-schemas for better organization and readability
export const CodeActionParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  diagnostic: z
    .object({
      code: z.string().optional(),
      message: z.string(),
      range: z.object({
        start: createPositionSchema(),
        end: createPositionSchema(),
      }),
    })
    .optional()
    .describe('Diagnostic to match for code actions'),
  actionKind: z
    .enum(['quickfix', 'refactor', 'source'])
    .optional()
    .describe('Filter code actions by kind'),
  position: createPositionSchema().optional().describe('Position for context-aware code actions'),
  selectionStrategy: z.enum(['first', 'preferred', 'all', 'best-match']).default('first').optional()
    .describe(`Strategy for selecting from multiple available code actions:
• first: Apply the first available action (default, fastest)
• preferred: Select action matching preferredKinds order
• all: Apply multiple actions (limited by maxActions)
• best-match: Select action that specifically fixes the provided diagnostic`),
  preferredKinds: z
    .array(z.string())
    .optional()
    .describe(
      'Ordered list of preferred action kinds for "preferred" strategy. Common kinds: "quickfix", "refactor.extract", "refactor.inline", "source.fixAll"'
    ),
  maxActions: z
    .number()
    .min(1)
    .max(10)
    .default(5)
    .optional()
    .describe(
      'Safety limit: maximum actions to apply with "all" strategy (prevents runaway changes)'
    ),
});

export const RenameParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: createPositionSchema().describe(
    'Zero-based position of the symbol to rename. Must point to a character within the symbol name. Line 0 = first line, character 0 = first character. Most editors show line 1 for the first line, so subtract 1 from editor line numbers. Example: To rename a symbol on editor line 22, use line: 21'
  ),
  newName: z.string().describe('New name for the symbol'),
  maxFiles: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .optional()
    .describe('Maximum number of files to modify (safety limit)'),
  excludePatterns: z
    .array(z.string())
    .optional()
    .describe('Glob patterns to exclude from rename (e.g., node_modules)'),
});

export const FormatParamsSchema = z.object({
  uris: z
    .union([
      z.array(z.string()).describe('File URIs to format'),
      z.string().describe('Single file URI to format'),
    ])
    .describe('File URIs to format'),
  range: z
    .object({
      start: createPositionSchema(),
      end: createPositionSchema(),
    })
    .optional()
    .describe('Range to format (if omitted, formats entire file)'),
  options: z
    .object({
      tabSize: z.number().optional(),
      insertSpaces: z.boolean().optional(),
      insertFinalNewline: z.boolean().optional(),
      trimFinalNewlines: z.boolean().optional(),
      trimTrailingWhitespace: z.boolean().optional(),
    })
    .optional()
    .describe('Formatting options'),
});

export const TextEditParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  edits: z
    .array(
      z.object({
        range: z.object({
          start: createPositionSchema(),
          end: createPositionSchema(),
        }),
        newText: z.string().describe('Replacement text (empty string for deletion)'),
      })
    )
    .describe('Text edits to apply to the document'),
});

export const MultiFileEditParamsSchema = z.object({
  edits: z.array(TextEditParamsSchema).describe('Text edits to apply across multiple files'),
});

export const SearchReplaceParamsSchema = z.object({
  pattern: z.string().describe('Search pattern (supports regex when prefixed with /)'),
  replacement: z.string().describe('Replacement text (supports $1, $2 for regex groups)'),
  scope: z.enum(['file', 'directory', 'workspace']).describe('Scope of the search'),
  uri: z.string().optional().describe('File URI for file scope, directory URI for directory scope'),
  filePattern: z.string().optional().describe('Glob pattern to filter files (e.g., **/*.ts)'),
  maxReplacements: z
    .number()
    .min(1)
    .default(1000)
    .optional()
    .describe('Maximum replacements (safety limit)'),
  caseSensitive: z.boolean().default(true).optional().describe('Case sensitive search'),
  wholeWord: z.boolean().default(false).optional().describe('Match whole words only'),
  excludePatterns: z.array(z.string()).optional().describe('Glob patterns to exclude'),
});

export const FileOperationParamsSchema = z.object({
  operations: z
    .array(
      z.union([
        z.object({
          type: z.literal('create'),
          uri: z.string().describe('File URI to create'),
          content: z.string().optional().describe('Initial file content'),
          overwrite: z.boolean().default(false).optional(),
        }),
        z.object({
          type: z.literal('delete'),
          uri: z.string().describe('File URI to delete'),
          ignoreIfNotExists: z.boolean().default(false).optional(),
          recursive: z.boolean().default(false).optional(),
        }),
        z.object({
          type: z.literal('rename'),
          oldUri: z.string().describe('Current file URI'),
          newUri: z.string().describe('New file URI'),
          overwrite: z.boolean().default(false).optional(),
        }),
      ])
    )
    .describe('File operations to perform'),
});

export const SmartInsertParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  insertions: z
    .array(
      z.object({
        type: z.enum(['import', 'method', 'property', 'comment']).describe('Type of insertion'),
        content: z.string().describe('Content to insert'),
        className: z
          .string()
          .optional()
          .describe('Target class name for method/property insertions'),
        preferredLocation: z
          .enum(['top', 'bottom', 'beforeClass', 'afterImports', 'insideClass'])
          .optional()
          .describe('Preferred insertion location'),
        sortOrder: z.enum(['alphabetical', 'dependency', 'none']).default('none').optional(),
      })
    )
    .describe('Smart insertions to perform'),
});

const BatchOperationItemSchema = z.union([
  z.object({
    type: z.literal('codeAction'),
    actions: z.array(CodeActionParamsSchema),
  }),
  z.object({
    type: z.literal('rename'),
    rename: RenameParamsSchema,
  }),
  z.object({
    type: z.literal('format'),
    format: FormatParamsSchema,
  }),
  z.object({
    type: z.literal('organizeImports'),
  }),
  z.object({
    type: z.literal('textEdit'),
    textEdit: TextEditParamsSchema,
  }),
  z.object({
    type: z.literal('multiFileEdit'),
    multiFileEdit: MultiFileEditParamsSchema,
  }),
  z.object({
    type: z.literal('searchReplace'),
    searchReplace: SearchReplaceParamsSchema,
  }),
  z.object({
    type: z.literal('fileOperation'),
    fileOperation: FileOperationParamsSchema,
  }),
  z.object({
    type: z.literal('smartInsert'),
    smartInsert: SmartInsertParamsSchema,
  }),
]);

export const BatchOperationSchema = z.object({
  operations: z
    .array(BatchOperationItemSchema)
    .describe('List of operations to execute in sequence'),
});

export const ApplyEditParamsSchema = z.object({
  type: z.enum([
    'codeAction',
    'rename',
    'format',
    'organizeImports',
    'textEdit',
    'multiFileEdit',
    'searchReplace',
    'fileOperation',
    'smartInsert',
    'batch',
  ]).describe(`Type of edit operation to perform:
• codeAction: Apply fixes, refactors, or source actions (e.g., fix errors, extract method)
• rename: Rename symbols across the codebase (variables, functions, classes)
• format: Format code according to language rules
• organizeImports: Sort and optimize import statements
• textEdit: Apply direct text edits to a single file
• multiFileEdit: Apply text edits across multiple files
• searchReplace: Search and replace text across files
• fileOperation: Create, delete, or rename files
• smartInsert: Context-aware insertions (imports, methods, etc.)
• batch: Execute multiple operations in a single transaction`),
  actions: z
    .array(CodeActionParamsSchema)
    .optional()
    .describe('Parameters for code action operations'),
  rename: RenameParamsSchema.optional().describe('Parameters for rename operations'),
  format: FormatParamsSchema.optional().describe('Parameters for format operations'),
  textEdit: TextEditParamsSchema.optional().describe('Parameters for direct text edit operations'),
  multiFileEdit: MultiFileEditParamsSchema.optional().describe(
    'Parameters for multi-file text edit operations'
  ),
  batchOperations: BatchOperationSchema.optional().describe('Parameters for batch operations'),
  searchReplace: SearchReplaceParamsSchema.optional().describe(
    'Parameters for search and replace operations'
  ),
  fileOperation: FileOperationParamsSchema.optional().describe('Parameters for file operations'),
  smartInsert: SmartInsertParamsSchema.optional().describe(
    'Parameters for smart insert operations'
  ),
  dryRun: z
    .boolean()
    .default(false)
    .optional()
    .describe('Preview mode: analyze what changes would be made without applying them'),
  atomic: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Transaction mode: if any edit fails, automatically rollback all changes (default: true for safety)'
    ),
});

export type ApplyEditParams = z.infer<typeof ApplyEditParamsSchema>;
