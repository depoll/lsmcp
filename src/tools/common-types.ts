/**
 * Common type aliases and interfaces for MCP tools
 * Reduces repetition and improves consistency
 */

import { z } from 'zod';

/**
 * File URI string - must be a valid file:// URI
 */
export type FileURI = string;

/**
 * Standard position in a text document (zero-based)
 */
export interface Position {
  /** Zero-based line number */
  line: number;
  /** Zero-based character offset */
  character: number;
}

/**
 * Range in a text document
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Location in a file
 */
export interface Location {
  uri: FileURI;
  range: Range;
}

/**
 * Standard batch request structure
 */
export interface BatchRequest<T> {
  /** Individual requests to process */
  requests: T[];
  /** Batch processing options */
  options?: {
    /** Deduplicate results across batch items */
    deduplicate?: boolean;
    /** Maximum results per individual request */
    maxResultsPerItem?: number;
  };
}

/**
 * Standard result structure with metadata
 */
export interface StandardResult<T> {
  /** Actual result data */
  data: T;
  /** Result metadata */
  metadata?: {
    /** Total results found (before limiting) */
    total?: number;
    /** Whether results were truncated */
    truncated?: boolean;
    /** Whether result was served from cache */
    cached?: boolean;
    /** Processing time in milliseconds */
    processingTime?: number;
  };
  /** Fallback suggestion if operation failed */
  fallback?: string;
  /** Error information if operation failed */
  error?: string;
}

/**
 * Progress information for streaming operations
 */
export interface ProgressInfo {
  /** Current item being processed */
  current?: number;
  /** Total items to process */
  total?: number;
  /** Percentage complete (0-100) */
  percentage?: number;
  /** Progress message */
  message?: string;
  /** Current file being processed */
  currentFile?: string;
}

/**
 * Common MCP error codes
 */
export enum MCPErrorCode {
  /** No language server available */
  NO_LANGUAGE_SERVER = 'ERR_NO_LSP',
  /** Invalid position in document */
  INVALID_POSITION = 'ERR_INVALID_POS',
  /** File not found or inaccessible */
  FILE_NOT_FOUND = 'ERR_FILE_404',
  /** Operation timed out */
  TIMEOUT = 'ERR_TIMEOUT',
  /** Feature not supported by language server */
  NOT_SUPPORTED = 'ERR_NOT_SUPPORTED',
  /** Invalid parameters */
  INVALID_PARAMS = 'ERR_INVALID_PARAMS',
  /** Internal server error */
  InternalError = 'ERR_INTERNAL',
  /** Invalid request */
  InvalidRequest = 'ERR_INVALID_REQUEST',
}

/**
 * MCPError class for creating error instances
 */
export class MCPError extends Error {
  code: MCPErrorCode;
  details?: unknown;

  constructor(code: MCPErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Reusable Zod schemas
 */
export const positionSchema = z.object({
  line: z.number().min(0),
  character: z.number().min(0),
});

export const rangeSchema = z.object({
  start: positionSchema,
  end: positionSchema,
});

export const locationSchema = z.object({
  uri: z.string(),
  range: rangeSchema,
});

/**
 * Type guard for Position
 */
export function isPosition(value: unknown): value is Position {
  return (
    typeof value === 'object' &&
    value !== null &&
    'line' in value &&
    'character' in value &&
    typeof (value as Position).line === 'number' &&
    typeof (value as Position).character === 'number'
  );
}

/**
 * Type guard for Location
 */
export function isLocation(value: unknown): value is Location {
  return (
    typeof value === 'object' &&
    value !== null &&
    'uri' in value &&
    'range' in value &&
    typeof (value as Location).uri === 'string' &&
    isRange((value as Location).range)
  );
}

/**
 * Type guard for Range
 */
export function isRange(value: unknown): value is Range {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    'end' in value &&
    isPosition((value as Range).start) &&
    isPosition((value as Range).end)
  );
}
