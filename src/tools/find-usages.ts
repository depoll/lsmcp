import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
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
} from 'vscode-languageserver-protocol';
import { logger as rootLogger } from '../utils/logger.js';

// Configuration constants
const DEFAULT_STREAM_BATCH_SIZE = 20;

const logger = rootLogger.child({ module: 'find-usages-tool' });

const positionSchema = z.object({
  line: z.number().min(0),
  character: z.number().min(0),
});

const batchItemSchema = z.object({
  uri: z.string().url(),
  position: positionSchema,
});

export const findUsagesParamsSchema = z.object({
  uri: z.string().url(),
  position: positionSchema,
  batch: z.array(batchItemSchema).optional(),
  type: z.enum(['references', 'callHierarchy']),
  direction: z.enum(['incoming', 'outgoing']).optional().describe('For call hierarchy only'),
  maxResults: z.number().positive(),
  maxDepth: z.number().positive().max(10),
  includeDeclaration: z.boolean(),
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

export interface FindUsagesResult {
  references?: ReferenceResult[];
  hierarchy?: CallHierarchyResult;
  total?: number;
}

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
}

export class FindUsagesTool extends BatchableTool<FindUsagesParams, FindUsagesResult> {
  name = 'findUsages';
  description = 'Find all references or call hierarchy for a symbol';
  inputSchema = findUsagesParamsSchema;
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

        return { references: allReferences, total: allReferences.length };
      } else {
        const references = await this.findReferences(validatedParams);
        return { references, total: references.length };
      }
    } else {
      const hierarchy = await this.findCallHierarchy(validatedParams);
      return { hierarchy };
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
    const connection = await this.clientManager.getForFile(params.uri, workspaceDir);

    if (!connection) {
      throw new Error(`No language server available for ${params.uri}`);
    }

    const referenceParams: ReferenceParams = {
      textDocument: { uri: params.uri },
      position: params.position,
      context: { includeDeclaration: params.includeDeclaration },
    };

    logger.info('Finding references', { uri: params.uri, position: params.position });

    try {
      const locations = await connection.sendRequest<Location[]>(
        'textDocument/references',
        referenceParams
      );

      if (!locations || locations.length === 0) {
        logger.info('No references found');
        return [];
      }

      // Convert locations to references
      const references: ReferenceResult[] = [];

      for (const location of locations.slice(0, params.maxResults)) {
        references.push({
          uri: location.uri,
          range: location.range,
          kind: this.classifyUsage(params, location),
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
      const items = await connection.sendRequest<CallHierarchyItem[] | null>(
        'textDocument/prepareCallHierarchy',
        prepareParams
      );

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
   * Extract workspace directory from a file URI with cross-platform support.
   * 
   * @param uri - The file URI (e.g., 'file:///path/to/file.ts')
   * @returns The workspace directory path
   * 
   * @example
   * ```typescript
   * extractWorkspaceDir('file:///home/user/project/src/file.ts')
   * // Returns: '/home/user/project/src'
   * 
   * extractWorkspaceDir('file:///C:/Users/user/project/src/file.ts')  
   * // Returns: 'C:/Users/user/project/src'
   * ```
   */
  private extractWorkspaceDir(uri: string): string {
    try {
      // Parse the URI to handle encoded characters and validate format
      const parsed = new URL(uri);
      
      if (parsed.protocol !== 'file:') {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      
      let filePath = parsed.pathname;
      
      // Handle Windows paths (remove leading slash on Windows)
      if (process.platform === 'win32' && filePath.startsWith('/') && filePath.match(/^\/[A-Za-z]:/)) {
        filePath = filePath.slice(1);
      }
      
      // Extract directory (everything before the last slash)
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash <= 0) {
        // If no slash or at root, return a sensible default
        return process.platform === 'win32' ? 'C:/' : '/';
      }
      
      return filePath.substring(0, lastSlash);
    } catch (error) {
      logger.error({ uri, error }, 'Failed to extract workspace directory from URI');
      throw new Error(`Invalid URI format: ${uri}`);
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
    if (
      location.uri === params.uri &&
      location.range.start.line === params.position.line &&
      location.range.start.character === params.position.character
    ) {
      return 'declaration';
    }

    // Default to 'read' for all other references
    // This is a conservative choice that works for most use cases
    return 'read';
  }
}
