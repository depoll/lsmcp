import { z } from 'zod';
import { BatchableTool, StreamingTool } from './base.js';
import { ConnectionPool } from '../lsp/connection-pool.js';
import {
  Location,
  Position,
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
import { TextDocumentPositionParams } from 'vscode-languageserver-protocol';
import { logger as rootLogger } from '../utils/logger.js';

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
  type: z.enum(['references', 'callHierarchy']).default('references'),
  direction: z.enum(['incoming', 'outgoing']).optional().describe('For call hierarchy only'),
  maxResults: z.number().positive().default(1000),
  maxDepth: z.number().positive().max(10).default(3).describe('For call hierarchy only'),
  includeDeclaration: z.boolean().default(true),
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

export class FindUsagesTool extends BatchableTool<FindUsagesParams, FindUsagesResult> implements StreamingTool<FindUsagesParams, StreamingFindUsagesResult> {
  name = 'findUsages';
  description = 'Find all references or call hierarchy for a symbol';
  inputSchema = findUsagesParamsSchema;
  
  constructor(private connectionPool: ConnectionPool) {
    super();
  }

  async execute(params: FindUsagesParams): Promise<FindUsagesResult> {
    // Validate parameters first
    const validated = this.validateParams(params);
    
    if (validated.batch) {
      return this.executeBatch(validated);
    }

    if (validated.type === 'references') {
      const references = await this.findReferences(validated);
      return { references, total: references.length };
    } else {
      const hierarchy = await this.findCallHierarchy(validated);
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
    const connection = await this.connectionPool.getConnection(params.uri);
    
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

      // Group by file and get preview text
      const references: ReferenceResult[] = [];
      const fileGroups = new Map<string, Location[]>();

      for (const location of locations.slice(0, params.maxResults)) {
        const existing = fileGroups.get(location.uri) || [];
        existing.push(location);
        fileGroups.set(location.uri, existing);
      }

      // Process each file
      for (const [uri, locs] of fileGroups) {
        for (const loc of locs) {
          references.push({
            uri: loc.uri,
            range: loc.range,
            kind: this.classifyUsage(params, loc),
          });
        }
      }

      return references;
    } catch (error) {
      logger.error('Error finding references', { error });
      throw error;
    }
  }

  private async findCallHierarchy(params: FindUsagesParams): Promise<CallHierarchyResult | undefined> {
    const connection = await this.connectionPool.getConnection(params.uri);
    
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
    connection: any,
    item: CallHierarchyItem,
    maxDepth: number,
    currentDepth: number = 0,
    visited: Set<string> = new Set()
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

      for (const call of incomingCalls) {
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
    connection: any,
    item: CallHierarchyItem,
    maxDepth: number,
    currentDepth: number = 0,
    visited: Set<string> = new Set()
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

      for (const call of outgoingCalls) {
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

  private async *streamReferences(params: FindUsagesParams): AsyncGenerator<StreamingFindUsagesResult> {
    yield {
      type: 'progress',
      progress: { message: 'Finding references...' },
    };

    try {
      const connection = await this.connectionPool.getConnection(params.uri);
      
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
      const BATCH_SIZE = 20;

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
            percentage: Math.round(((Math.min(i + BATCH_SIZE, total)) / total) * 100),
            message: `Found ${Math.min(i + BATCH_SIZE, total)} of ${total} references`,
          },
        };

        // Allow other operations
        await new Promise(resolve => setImmediate(resolve));
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

  private async *streamCallHierarchy(params: FindUsagesParams): AsyncGenerator<StreamingFindUsagesResult> {
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

  private classifyUsage(params: FindUsagesParams, location: Location): ReferenceResult['kind'] {
    // Simple classification based on location
    if (
      location.uri === params.uri &&
      location.range.start.line === params.position.line &&
      location.range.start.character === params.position.character
    ) {
      return 'declaration';
    }
    // More sophisticated classification would require parsing the code
    return 'read';
  }

  protected async executeBatch(params: FindUsagesParams): Promise<FindUsagesResult> {
    if (!params.batch) {
      throw new Error('Batch parameter required for batch execution');
    }

    const allReferences: ReferenceResult[] = [];
    
    // Process batch items in parallel
    const promises = params.batch.map(async (item) => {
      const singleParams: FindUsagesParams = {
        ...params,
        uri: item.uri,
        position: item.position,
        batch: undefined,
      };
      
      const result = await this.execute(singleParams);
      return result.references || [];
    });

    const results = await Promise.all(promises);
    
    // Flatten and deduplicate
    for (const refs of results) {
      allReferences.push(...refs);
    }

    // Deduplicate by uri and range
    const seen = new Set<string>();
    const unique = allReferences.filter(ref => {
      const key = `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}:${ref.range.end.line}:${ref.range.end.character}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Sort by relevance
    unique.sort((a, b) => {
      // Same file first
      if (a.uri === params.uri && b.uri !== params.uri) return -1;
      if (a.uri !== params.uri && b.uri === params.uri) return 1;
      
      // Then by line number
      return a.range.start.line - b.range.start.line;
    });

    return {
      references: unique.slice(0, params.maxResults),
      total: unique.length,
    };
  }
}