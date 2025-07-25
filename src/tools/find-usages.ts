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

export class FindUsagesTool extends BatchableTool<FindUsagesParams, FindUsagesResult> {
  name = 'findUsages';
  description = 'Find all references or call hierarchy for a symbol';
  inputSchema = findUsagesParamsSchema;

  constructor(connectionPool: ConnectionPool) {
    super(connectionPool);
  }

  async execute(params: FindUsagesParams): Promise<FindUsagesResult> {
    if (params.type === 'references') {
      const references = await this.findReferences(params);
      return { references, total: references.length };
    } else {
      const hierarchy = await this.findCallHierarchy(params);
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
    const connection = await this.clientManager.getForFile(params.uri, 'auto');

    const referenceParams: ReferenceParams = {
      textDocument: { uri: params.uri },
      position: params.position,
      context: { includeDeclaration: params.includeDeclaration },
    };

    logger.info('Finding references', { uri: params.uri, position: params.position });

    if (!connection) {
      throw new Error(`No language server available for ${params.uri}`);
    }

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
    const connection = await this.clientManager.getForFile(params.uri, 'auto');

    const prepareParams: CallHierarchyPrepareParams = {
      textDocument: { uri: params.uri },
      position: params.position,
    };

    logger.info('Preparing call hierarchy', { uri: params.uri, position: params.position });

    if (!connection) {
      throw new Error(`No language server available for ${params.uri}`);
    }

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
    connection: { sendRequest: (method: string, params: unknown) => Promise<unknown> },
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
      const incomingCalls = (await connection.sendRequest(
        'callHierarchy/incomingCalls',
        params
      )) as CallHierarchyIncomingCall[];

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
    connection: { sendRequest: (method: string, params: unknown) => Promise<unknown> },
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
      const outgoingCalls = (await connection.sendRequest(
        'callHierarchy/outgoingCalls',
        params
      )) as CallHierarchyOutgoingCall[];

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
      const connection = await this.clientManager.getForFile(params.uri, 'auto');

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

      const locations = (await connection.sendRequest(
        'textDocument/references',
        referenceParams
      )) as Location[];

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

  async executeBatch(items: FindUsagesParams[]): Promise<FindUsagesResult[]> {
    this.logger.info({ count: items.length }, 'Executing find usages batch operation');

    const results = await Promise.allSettled(items.map((item) => this.execute(item)));

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        this.logger.error(
          { error: result.reason as Error, item: items[index] },
          'Find usages batch item failed'
        );
        throw result.reason as Error;
      }
    });
  }
}
