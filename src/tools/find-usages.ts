import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import { pathToFileUri, normalizeUri } from '../utils/logger.js';
import {
  Location,
  Range,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  ReferenceParams,
  CallHierarchyPrepareParams,
  CallHierarchyIncomingCallsParams,
  CallHierarchyOutgoingCallsParams,
  SymbolKind,
  DidOpenTextDocumentParams,
} from 'vscode-languageserver-protocol';
import { logger as rootLogger } from '../utils/logger.js';
import { USAGE_POSITION_DESCRIPTION } from './position-schema.js';
import { FILE_URI_DESCRIPTION, BATCH_FILE_URI_DESCRIPTION } from './file-uri-description.js';
import { retryWithBackoff } from '../utils/retry.js';
import { StandardResult, ToolAnnotations } from './common-types.js';

// Configuration constants
const DEFAULT_STREAM_BATCH_SIZE = 20;

const logger = rootLogger.child({ module: 'find-usages-tool' });

// Create a flattened schema for MCP compatibility
// This avoids nested schema issues that cause problems with some MCP clients like Gemini
export const findUsagesParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: z
    .object({
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
    })
    .describe(USAGE_POSITION_DESCRIPTION),
  batch: z
    .array(
      z.object({
        uri: z.string().describe(BATCH_FILE_URI_DESCRIPTION),
        position: z.object({
          line: z.number().min(0),
          character: z.number().min(0),
        }),
      })
    )
    .optional()
    .describe('Batch references (type="references" only). Each: uri, position. Auto-deduplicates.'),
  type: z
    .enum(['references', 'callHierarchy'])
    .describe('Analysis type: references (usage locations) or callHierarchy (function call tree)'),
  direction: z
    .enum(['incoming', 'outgoing'])
    .optional()
    .describe('Call direction (callHierarchy only): incoming (callers) or outgoing (callees)'),
  maxResults: z
    .number()
    .min(1)
    .max(10000)
    .describe('Max results. References: 50-500. CallHierarchy: 10-50 per level. Range: 1-10000'),
  maxDepth: z
    .number()
    .min(1)
    .max(10)
    .describe('Call hierarchy depth. 1=direct, 3=recommended, 5+=deep. Range: 1-10'),
  includeDeclaration: z
    .boolean()
    .describe('Include declaration in references. true=include definition, false=usage only'),
});

export type FindUsagesParams = z.infer<typeof findUsagesParamsSchema>;

export interface ReferenceResult {
  uri: string;
  range: Range;
  preview?: string;
  kind?: 'read' | 'write' | 'call' | 'declaration' | 'import';
}

export interface CallHierarchyResult {
  name: string;
  kind: SymbolKind;
  uri: string;
  range: Range;
  selectionRange: Range;
  detail?: string;
  calls?: CallHierarchyResult[];
}

export interface FindUsagesResultData {
  references?: ReferenceResult[];
  hierarchy?: CallHierarchyResult;
  total?: number;
}

export type FindUsagesResult = StandardResult<FindUsagesResultData>;

export interface StreamingFindUsagesResult {
  type: 'progress' | 'partial' | 'complete';
  data?: ReferenceResult[] | CallHierarchyResult;
  progress?: {
    current?: number;
    total?: number;
    percentage?: number;
    message?: string;
    currentFile?: string;
  };
  error?: string;
}

export interface FindUsagesConfig {
  streamBatchSize?: number;
}

// Type-safe LSP connection interface
export interface LSPConnection {
  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
  sendNotification?(method: string, params?: unknown): void;
}

export class FindUsagesTool extends BatchableTool<FindUsagesParams, FindUsagesResult> {
  name = 'findUsages';
  description = `Find symbol references or call hierarchy.

Modes:
- references: All usage locations (read, write, import)
- callHierarchy: Function call flow (incoming/outgoing)

Features: Batch processing, streaming results, deduplication.

Required parameters:
- uri: File URI containing the symbol
- position: Symbol position (line, character)
- type: 'references' or 'callHierarchy'
- maxResults: Maximum results (1-10000)
- maxDepth: Call hierarchy depth (1-10)
- includeDeclaration: Include declaration in references (boolean)`;
  inputSchema = findUsagesParamsSchema;

  /** Output schema for MCP tool discovery */
  readonly outputSchema = z.object({
    data: z.object({
      references: z
        .array(
          z.object({
            uri: z.string(),
            range: z.object({
              start: z.object({
                line: z.number(),
                character: z.number(),
              }),
              end: z.object({
                line: z.number(),
                character: z.number(),
              }),
            }),
            preview: z.string().optional(),
            kind: z.enum(['read', 'write', 'call', 'declaration', 'import']).optional(),
          })
        )
        .optional(),
      hierarchy: z.any().optional(), // Complex recursive type
      total: z.number().optional(),
    }),
    metadata: z
      .object({
        processingTime: z.number().optional(),
        cached: z.boolean().optional(),
      })
      .optional(),
    fallback: z.string().optional(),
    error: z.string().optional(),
  });

  /** MCP tool annotations */
  readonly annotations: ToolAnnotations = {
    title: 'Find Usages',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  private config: FindUsagesConfig;

  constructor(connectionPool: ConnectionPool, config: FindUsagesConfig = {}) {
    super(connectionPool);
    this.config = {
      streamBatchSize: config.streamBatchSize ?? DEFAULT_STREAM_BATCH_SIZE,
    };
  }

  /**
   * Execute find usages operation for a symbol at the given position.
   *
   * @param params - The find usages parameters including URI, position, and type
   * @returns Promise resolving to references or call hierarchy results
   *
   * @example
   * ```typescript
   * const result = await tool.execute({
   *   uri: 'file:///path/to/file.ts',
   *   position: { line: 10, character: 5 },
   *   type: 'references',
   *   maxResults: 100,
   *   maxDepth: 3,
   *   includeDeclaration: true
   * });
   * ```
   */
  async execute(params: FindUsagesParams): Promise<FindUsagesResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      const validatedParams = this.validateParams(params);

      if (validatedParams.type === 'references') {
        if (validatedParams.batch && validatedParams.batch.length > 0) {
          // Process batch requests and deduplicate results
          const allReferences: ReferenceResult[] = [];
          const seen = new Set<string>();

          for (const batchItem of validatedParams.batch) {
            const batchParams = {
              ...validatedParams,
              uri: batchItem.uri,
              position: batchItem.position,
            };
            const references = await this.findReferences(batchParams);

            for (const ref of references) {
              const key = `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}`;
              if (!seen.has(key)) {
                seen.add(key);
                allReferences.push(ref);
              }
            }
          }

          return {
            data: { references: allReferences, total: allReferences.length },
            metadata: {
              processingTime: Date.now() - startTime,
              cached: false,
            },
          };
        } else {
          const references = await this.findReferences(validatedParams);
          return {
            data: { references, total: references.length },
            metadata: {
              processingTime: Date.now() - startTime,
              cached: false,
            },
          };
        }
      } else {
        const hierarchy = await this.findCallHierarchy(validatedParams);
        return {
          data: { hierarchy },
          metadata: {
            processingTime: Date.now() - startTime,
            cached: false,
          },
        };
      }
    } catch (error) {
      logger.error({ error, params }, 'Find usages failed');

      return {
        data: {
          references: [],
          total: 0,
        },
        metadata: {
          processingTime: Date.now() - startTime,
          cached: false,
        },
        error: error instanceof Error ? error.message : String(error),
        fallback: this.generateFallback(params),
      };
    }
  }

  private generateFallback(params: FindUsagesParams): string {
    const filename = params.uri.split('/').pop() || 'file';
    if (params.type === 'references') {
      return `No references found. Try: grep -r "symbol_name" --include="*.${filename.split('.').pop()}"`;
    } else {
      return `Call hierarchy unavailable. Try: grep -r "function_name" --include="*.${filename.split('.').pop()}"`;
    }
  }

  async *stream(params: FindUsagesParams): AsyncGenerator<StreamingFindUsagesResult> {
    if (params.type === 'references') {
      yield* this.streamReferences(params);
    } else {
      yield* this.streamCallHierarchy(params);
    }
  }

  private async findReferences(params: FindUsagesParams): Promise<ReferenceResult[]> {
    const workspaceDir = this.extractWorkspaceDir(params.uri);
    logger.info(`Find references: URI=${params.uri}, workspace=${workspaceDir}`);
    const connection = await this.clientManager.getForFile(params.uri, workspaceDir);

    if (!connection) {
      throw new Error(`No language server available for ${params.uri}`);
    }

    // Validate position bounds to avoid TypeScript server errors
    if (params.position.line < 0 || params.position.character < 0) {
      logger.warn('Invalid position (negative values)', params.position);
      return [];
    }

    // Basic bounds check - if position is extremely large, return empty
    if (params.position.line > 10000 || params.position.character > 1000) {
      logger.warn('Position likely out of bounds', params.position);
      return [];
    }

    // Ensure the document and related files are open in the language server
    await this.ensureWorkspaceOpen(connection, params.uri, workspaceDir);

    const referenceParams: ReferenceParams = {
      textDocument: { uri: params.uri },
      position: params.position,
      context: { includeDeclaration: params.includeDeclaration },
    };

    logger.info('Finding references', {
      uri: params.uri,
      position: params.position,
      workspaceDir,
    });

    try {
      const locations = await retryWithBackoff(
        async () => {
          const result = await connection.sendRequest<Location[]>(
            'textDocument/references',
            referenceParams
          );

          // If we get null or empty references, it might be due to indexing lag
          if (!result || result.length === 0) {
            throw new Error('No references found - possible indexing lag');
          }

          return result;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          shouldRetry: (error: unknown) => {
            if (error instanceof Error) {
              return error.message.includes('No references found');
            }
            return false;
          },
          onRetry: (error: unknown, attempt: number) => {
            logger.info(
              { error, uri: params.uri, position: params.position, attempt },
              'Retrying references due to possible indexing lag'
            );
          },
        }
      ).catch((error: unknown) => {
        // Don't swallow LSP errors - let them propagate
        if (!(error instanceof Error) || !error.message.includes('No references found')) {
          throw error;
        }
        return null; // Only return null for "no references" case
      });

      logger.info('LSP references response', {
        locationsCount: locations?.length || 0,
        locations: locations?.slice(0, 3), // Log first 3 for debugging
        requestParams: referenceParams,
      });

      if (!locations || locations.length === 0) {
        logger.warn('No references found', { uri: params.uri, position: params.position });
        return [];
      }

      // Convert locations to references
      const references: ReferenceResult[] = [];

      for (const location of locations.slice(0, params.maxResults)) {
        const preview = await this.generatePreview(location);
        references.push({
          uri: location.uri,
          range: location.range,
          kind: this.classifyUsage(params, location),
          preview,
        });
      }

      return references;
    } catch (error) {
      logger.error('Error finding references', { error });
      throw error;
    }
  }

  private async findCallHierarchy(
    params: FindUsagesParams
  ): Promise<CallHierarchyResult | undefined> {
    const workspaceDir = this.extractWorkspaceDir(params.uri);
    const connection = await this.clientManager.getForFile(params.uri, workspaceDir);

    if (!connection) {
      throw new Error(`No language server available for ${params.uri}`);
    }

    const prepareParams: CallHierarchyPrepareParams = {
      textDocument: { uri: params.uri },
      position: params.position,
    };

    logger.info('Preparing call hierarchy', { uri: params.uri, position: params.position });

    try {
      // First, prepare the call hierarchy
      const items = await retryWithBackoff(
        async () => {
          const result = await connection.sendRequest<CallHierarchyItem[] | null>(
            'textDocument/prepareCallHierarchy',
            prepareParams
          );

          // If we get null or empty items, it might be due to indexing lag
          if (!result || result.length === 0) {
            throw new Error('No call hierarchy items found - possible indexing lag');
          }

          return result;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          shouldRetry: (error: unknown) => {
            if (error instanceof Error) {
              return error.message.includes('No call hierarchy items');
            }
            return false;
          },
          onRetry: (error: unknown, attempt: number) => {
            logger.info(
              { error, uri: params.uri, position: params.position, attempt },
              'Retrying call hierarchy preparation due to possible indexing lag'
            );
          },
        }
      ).catch((error: unknown) => {
        // Don't swallow LSP errors - let them propagate
        if (!(error instanceof Error) || !error.message.includes('No call hierarchy items')) {
          throw error;
        }
        return null; // Only return null for "no call hierarchy" case
      });

      if (!items || items.length === 0) {
        logger.info('No call hierarchy items found');
        return undefined;
      }

      const item = items[0]; // Use the first item
      if (!item) {
        return undefined;
      }

      const result: CallHierarchyResult = {
        name: item.name,
        kind: item.kind,
        uri: item.uri,
        range: item.range,
        selectionRange: item.selectionRange,
        detail: item.detail,
        calls: [],
      };

      // Get incoming or outgoing calls based on direction
      if (params.direction === 'incoming') {
        result.calls = await this.getIncomingCalls(connection, item, params.maxDepth);
      } else if (params.direction === 'outgoing') {
        result.calls = await this.getOutgoingCalls(connection, item, params.maxDepth);
      }

      return result;
    } catch (error) {
      logger.error('Error finding call hierarchy', { error });
      throw error;
    }
  }

  private async getIncomingCalls(
    connection: LSPConnection,
    item: CallHierarchyItem,
    maxDepth: number,
    currentDepth = 0,
    visited = new Set<string>()
  ): Promise<CallHierarchyResult[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
    if (visited.has(key)) {
      return []; // Avoid cycles
    }
    visited.add(key);

    const params: CallHierarchyIncomingCallsParams = { item };

    try {
      const incomingCalls = await connection.sendRequest<CallHierarchyIncomingCall[]>(
        'callHierarchy/incomingCalls',
        params
      );

      const results: CallHierarchyResult[] = [];

      for (const call of incomingCalls || []) {
        const result: CallHierarchyResult = {
          name: call.from.name,
          kind: call.from.kind,
          uri: call.from.uri,
          range: call.from.range,
          selectionRange: call.from.selectionRange,
          detail: call.from.detail,
          calls: [],
        };

        // Recursively get incoming calls
        result.calls = await this.getIncomingCalls(
          connection,
          call.from,
          maxDepth,
          currentDepth + 1,
          visited
        );

        results.push(result);
      }

      return results;
    } catch (error) {
      logger.error('Error getting incoming calls', { error });
      return [];
    }
  }

  private async getOutgoingCalls(
    connection: LSPConnection,
    item: CallHierarchyItem,
    maxDepth: number,
    currentDepth = 0,
    visited = new Set<string>()
  ): Promise<CallHierarchyResult[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
    if (visited.has(key)) {
      return []; // Avoid cycles
    }
    visited.add(key);

    const params: CallHierarchyOutgoingCallsParams = { item };

    try {
      const outgoingCalls = await connection.sendRequest<CallHierarchyOutgoingCall[]>(
        'callHierarchy/outgoingCalls',
        params
      );

      const results: CallHierarchyResult[] = [];

      for (const call of outgoingCalls || []) {
        const result: CallHierarchyResult = {
          name: call.to.name,
          kind: call.to.kind,
          uri: call.to.uri,
          range: call.to.range,
          selectionRange: call.to.selectionRange,
          detail: call.to.detail,
          calls: [],
        };

        // Recursively get outgoing calls
        result.calls = await this.getOutgoingCalls(
          connection,
          call.to,
          maxDepth,
          currentDepth + 1,
          visited
        );

        results.push(result);
      }

      return results;
    } catch (error) {
      logger.error('Error getting outgoing calls', { error });
      return [];
    }
  }

  private async *streamReferences(
    params: FindUsagesParams
  ): AsyncGenerator<StreamingFindUsagesResult> {
    yield {
      type: 'progress',
      progress: { message: 'Finding references...' },
    };

    try {
      const workspaceDir = this.extractWorkspaceDir(params.uri);
      const connection = await this.clientManager.getForFile(params.uri, workspaceDir);

      if (!connection) {
        yield {
          type: 'complete',
          error: `No language server available for ${params.uri}`,
        };
        return;
      }

      const referenceParams: ReferenceParams = {
        textDocument: { uri: params.uri },
        position: params.position,
        context: { includeDeclaration: params.includeDeclaration },
      };

      const locations = await connection.sendRequest<Location[]>(
        'textDocument/references',
        referenceParams
      );

      if (!locations || locations.length === 0) {
        yield {
          type: 'complete',
          data: [],
          progress: { total: 0 },
        };
        return;
      }

      const total = Math.min(locations.length, params.maxResults);
      const BATCH_SIZE = this.config.streamBatchSize!;

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = locations.slice(i, Math.min(i + BATCH_SIZE, total));
        const references: ReferenceResult[] = [];

        for (const location of batch) {
          references.push({
            uri: location.uri,
            range: location.range,
            kind: this.classifyUsage(params, location),
          });
        }

        yield {
          type: 'partial',
          data: references,
          progress: {
            current: Math.min(i + BATCH_SIZE, total),
            total,
            percentage: Math.round((Math.min(i + BATCH_SIZE, total) / total) * 100),
            message: `Found ${Math.min(i + BATCH_SIZE, total)} of ${total} references`,
          },
        };

        // Allow other operations
        await new Promise((resolve) => setImmediate(resolve));
      }

      yield {
        type: 'complete',
        progress: { total },
      };
    } catch (error) {
      yield {
        type: 'complete',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async *streamCallHierarchy(
    params: FindUsagesParams
  ): AsyncGenerator<StreamingFindUsagesResult> {
    yield {
      type: 'progress',
      progress: { message: `Finding ${params.direction} calls...` },
    };

    try {
      const hierarchy = await this.findCallHierarchy(params);

      if (hierarchy) {
        yield {
          type: 'complete',
          data: hierarchy,
        };
      } else {
        yield {
          type: 'complete',
          progress: { total: 0 },
        };
      }
    } catch (error) {
      yield {
        type: 'complete',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract workspace directory from a file URI.
   *
   * @param uri - The file URI (e.g., 'file:///path/to/file.ts')
   * @returns The workspace directory path
   *
   * @example
   * ```typescript
   * extractWorkspaceDir('file:///home/user/project/src/file.ts')
   * // Returns: '/home/user/project/src'
   * ```
   */
  extractWorkspaceDir(uri: string): string {
    try {
      // Parse the URI to handle encoded characters and validate format
      const parsed = new URL(uri);

      if (parsed.protocol !== 'file:') {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }

      let filePath = parsed.pathname;

      // Extract directory (everything before the last slash) - Unix-style paths
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash <= 0) {
        // If no slash or at root, return Unix root
        return '/';
      }

      return filePath.substring(0, lastSlash);
    } catch (error) {
      logger.error({ uri, error }, 'Failed to extract workspace directory from URI');
      throw new Error(`Invalid URI format: ${uri}`);
    }
  }

  /**
   * Ensure all TypeScript files in the workspace are open for better cross-file references
   */
  private async ensureWorkspaceOpen(
    connection: LSPConnection,
    currentUri: string,
    workspaceDir: string
  ): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Find all TypeScript files in the workspace
      const files = await fs.readdir(workspaceDir);
      const tsFiles = files.filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

      logger.info(`Opening ${tsFiles.length} TypeScript files in workspace: ${workspaceDir}`, {
        files: tsFiles,
      });

      // Open each TypeScript file
      for (const file of tsFiles) {
        const filePath = path.join(workspaceDir, file);
        const fileUri = pathToFileUri(filePath);
        await this.ensureDocumentOpen(connection, fileUri);
      }
    } catch (error) {
      logger.warn(
        { error, workspaceDir },
        'Failed to open workspace files, proceeding with single file'
      );
      // Fallback to opening just the current document
      await this.ensureDocumentOpen(connection, currentUri);
    }
  }

  /**
   * Ensure a document is open in the language server by sending didOpen notification
   */
  private async ensureDocumentOpen(connection: LSPConnection, uri: string): Promise<void> {
    try {
      // Read the file content
      const fs = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const filePath = fileURLToPath(uri);
      const content = await fs.readFile(filePath, 'utf-8');

      // Determine language ID from file extension
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      let languageId = 'plaintext';
      switch (ext) {
        case 'ts':
          languageId = 'typescript';
          break;
        case 'js':
          languageId = 'javascript';
          break;
        case 'py':
          languageId = 'python';
          break;
        case 'rs':
          languageId = 'rust';
          break;
        case 'go':
          languageId = 'go';
          break;
        case 'java':
          languageId = 'java';
          break;
        case 'cpp':
        case 'cc':
        case 'cxx':
          languageId = 'cpp';
          break;
        case 'c':
          languageId = 'c';
          break;
        case 'rb':
          languageId = 'ruby';
          break;
        case 'php':
          languageId = 'php';
          break;
      }

      const didOpenParams: DidOpenTextDocumentParams = {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      };

      // Send didOpen notification (no response expected)
      if (connection.sendNotification) {
        void connection.sendNotification('textDocument/didOpen', didOpenParams);
        logger.debug(`Sent didOpen notification for: ${uri}`);
      } else {
        logger.warn('sendNotification not available on connection, skipping didOpen');
      }
    } catch (error) {
      logger.warn({ error, uri }, 'Failed to open document in language server, proceeding anyway');
      // Don't throw - this is not critical for functionality
    }
  }

  /**
   * Generate a preview of the code at a reference location
   */
  private async generatePreview(location: Location): Promise<string | undefined> {
    try {
      const fs = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const filePath = fileURLToPath(location.uri);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const lineIndex = location.range.start.line;
      if (lineIndex < 0 || lineIndex >= lines.length) {
        return undefined;
      }

      return lines[lineIndex]?.trim();
    } catch (error) {
      logger.debug({ error, location }, 'Failed to generate preview');
      return undefined;
    }
  }

  /**
   * Classify the usage type of a reference location.
   *
   * Current implementation provides basic classification:
   * - 'declaration': If the location matches the original query position
   * - 'read': Default for all other references
   *
   * Limitations:
   * - Does not distinguish between read/write operations
   * - Does not identify function calls vs variable references
   * - More sophisticated classification would require:
   *   - Parsing the code at each location
   *   - Using LSP semantic tokens (if available)
   *   - Analyzing the surrounding context
   *
   * @param params The original find usages parameters
   * @param location The reference location to classify
   * @returns The usage classification
   */
  private classifyUsage(params: FindUsagesParams, location: Location): ReferenceResult['kind'] {
    // Check if this is the original declaration/definition position
    // Allow for some tolerance in character position as LSP servers may return
    // slightly different positions for the same symbol
    // Use normalized URIs for comparison

    const normalizedLocationUri = normalizeUri(location.uri);
    const normalizedParamsUri = normalizeUri(params.uri);
    const lineMatch = location.range.start.line === params.position.line;
    const charMatch = Math.abs(location.range.start.character - params.position.character) <= 1;

    if (normalizedLocationUri === normalizedParamsUri && lineMatch && charMatch) {
      return 'declaration';
    }

    // Default to 'read' for all other references
    // This is a conservative choice that works for most use cases
    return 'read';
  }
}
