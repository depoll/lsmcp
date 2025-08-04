/**
 * Shared position schema definition for consistent position parameter documentation
 * across all MCP tools in the lsmcp project.
 */

import { z } from 'zod';

/**
 * Standard position schema used across all tools.
 *
 * Position represents a location within a text file using zero-based indexing.
 * This matches the Language Server Protocol (LSP) specification.
 */
export const createPositionSchema = (): z.ZodObject<{
  line: z.ZodNumber;
  character: z.ZodNumber;
}> =>
  z.object({
    line: z
      .number()
      .min(0)
      .describe(
        'Zero-based line number. The first line in a file is line 0. ' +
          'Example: line 0 = first line, line 10 = eleventh line. ' +
          "Must be within the file's line count."
      ),
    character: z
      .number()
      .min(0)
      .describe(
        'Zero-based character offset within the line. The first character in a line is at position 0. ' +
          'This counts UTF-16 code units (same as JavaScript string indexing). ' +
          'Example: character 0 = start of line, character 10 = eleventh character. ' +
          "Must be within the line's character count."
      ),
  });

/**
 * Enhanced position description with detailed explanation and examples.
 */
export const POSITION_DESCRIPTION =
  'Position in the file using zero-based indexing (LSP specification). ' +
  'The position identifies a specific character in the file. ' +
  'Examples: { line: 0, character: 0 } = start of file, ' +
  '{ line: 10, character: 15 } = line 11, column 16 in most editors, ' +
  '{ line: 5, character: 0 } = start of line 6. ' +
  'Note: Most text editors display line/column numbers starting from 1, ' +
  'so add 1 to both values for editor display.';

/**
 * Position description for symbol lookup operations
 */
export const SYMBOL_POSITION_DESCRIPTION =
  'Position of the symbol to analyze. Place the cursor anywhere within the symbol name. ' +
  'For example, to analyze a function named "processData", the position can be anywhere ' +
  'between the "p" and the last "a". The language server will identify the complete symbol.';

/**
 * Position description for navigation operations
 */
export const NAVIGATION_POSITION_DESCRIPTION =
  'Position of the symbol to navigate from. The cursor should be placed within the symbol name ' +
  'you want to navigate from (e.g., within a function call, variable reference, or type usage). ' +
  'The language server will find the symbol at this position and navigate to its definition/implementation.';

/**
 * Position description for finding usages
 */
export const USAGE_POSITION_DESCRIPTION =
  'Position of the symbol to find usages for. Place the cursor within the symbol name ' +
  '(function, variable, class, etc.) to find all locations where it is referenced. ' +
  "The position should be within the symbol's identifier, not in comments or strings.";

/**
 * Create a position schema with a specific description
 */
export function createPositionSchemaWithDescription(description: string): z.ZodObject<{
  line: z.ZodNumber;
  character: z.ZodNumber;
}> {
  return createPositionSchema().describe(description);
}
