import { Location, LocationLink, Position } from 'vscode-languageserver-protocol';
import { z } from 'zod';
import { ConnectionPool } from '../lsp/index.js';
import { getLanguageFromUri } from '../utils/languages.js';
import { BatchableTool } from './base.js';
import { FileAwareLRUCache } from '../utils/fileCache.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { relative, dirname } from 'path';

// Configuration
const CACHE_SIZE = 200;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_RESULTS = 100;

// Schema definitions
const PositionSchema = z.object({
  line: z.number().describe('Zero-based line number'),
  character: z.number().describe('Zero-based character offset'),
});

const NavigateTargetSchema = z
  .enum(['definition', 'implementation', 'typeDefinition'])
  .describe('Navigation target type');

const SingleNavigateSchema = z.object({
  uri: z.string().describe('File URI to navigate from'),
  position: PositionSchema,
  target: NavigateTargetSchema,
});

const NavigateParamsSchema = z.object({
  uri: z.string().optional().describe('File URI for single navigation'),
  position: PositionSchema.optional(),
  target: NavigateTargetSchema.optional(),
  batch: z.array(SingleNavigateSchema).optional().describe('Batch navigation requests'),
  maxResults: z
    .number()
    .default(DEFAULT_MAX_RESULTS)
    .optional()
    .describe('Maximum results per navigation request'),
});

type NavigateParams = z.infer<typeof NavigateParamsSchema>;
type SingleNavigateParams = z.infer<typeof SingleNavigateSchema>;

interface NavigateResultItem {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  preview?: string;
  kind?: string; // 'definition' | 'implementation' | 'type'
}

interface NavigateResult {
  results: NavigateResultItem[];
  fallbackSuggestion?: string;
}

export class NavigateTool extends BatchableTool<NavigateParams, NavigateResult> {
  readonly name = 'navigate';
  readonly description = 'Navigate to definitions, implementations, or type definitions';
  readonly inputSchema = NavigateParamsSchema;

  private cache: FileAwareLRUCache<NavigateResultItem[]>;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
    this.cache = new FileAwareLRUCache<NavigateResultItem[]>(CACHE_SIZE, CACHE_TTL);
  }

  async execute(params: NavigateParams): Promise<NavigateResult> {
    // Handle batch requests
    if (params.batch !== undefined) {
      if (params.batch.length === 0) {
        throw new Error('Batch navigation requires at least one navigation request');
      }
      return this.executeBatchNavigation(params.batch, params.maxResults);
    }

    // Single navigation request
    if (!params.uri || !params.position || !params.target) {
      throw new Error('Single navigation requires uri, position, and target');
    }

    const singleParams: SingleNavigateParams = {
      uri: params.uri,
      position: params.position,
      target: params.target,
    };

    try {
      const results = await this.navigateSingle(singleParams, params.maxResults);

      return {
        results,
        fallbackSuggestion:
          results.length === 0 ? this.getFallbackSuggestion(singleParams) : undefined,
      };
    } catch (error) {
      // For single navigation, return empty results with fallback suggestion
      this.logger.debug({ error, params: singleParams }, 'Single navigation failed');
      return {
        results: [],
        fallbackSuggestion: this.getFallbackSuggestion(singleParams),
      };
    }
  }

  private async executeBatchNavigation(
    batch: SingleNavigateParams[],
    maxResults?: number
  ): Promise<NavigateResult> {
    this.logger.info({ count: batch.length }, 'Executing batch navigation');

    const allResults: NavigateResultItem[] = [];
    const failedRequests: SingleNavigateParams[] = [];

    // Execute in parallel with error handling
    const results = await Promise.allSettled(
      batch.map((item) => this.navigateSingle(item, maxResults))
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        this.logger.warn(
          { error: result.reason as Error, request: batch[index] },
          'Batch navigation item failed'
        );
        failedRequests.push(batch[index] as SingleNavigateParams);
      }
    });

    // Provide fallback suggestion if there were any failures or if all results are empty
    const shouldProvideFallback =
      failedRequests.length > 0 || (allResults.length === 0 && batch.length > 0);

    return {
      results: allResults,
      fallbackSuggestion: shouldProvideFallback
        ? this.getFallbackSuggestion(failedRequests[0] || batch[0]!)
        : undefined,
    };
  }

  private async navigateSingle(
    params: SingleNavigateParams,
    maxResults?: number
  ): Promise<NavigateResultItem[]> {
    const { uri, position, target } = params;
    const cacheKey = `${uri}:${position.line}:${position.character}:${target}`;

    // Check cache
    const cached = await this.cache.get(cacheKey, uri);
    if (cached) {
      this.logger.debug({ uri, position, target }, 'Navigation cache hit');
      return cached.slice(0, maxResults);
    }

    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, uri);

    // Map target to LSP method
    const method = this.getNavigationMethod(target);
    const lspPosition: Position = {
      line: position.line,
      character: position.character,
    };

    try {
      const response = await client.sendRequest<Location | Location[] | LocationLink[] | null>(
        method,
        {
          textDocument: { uri },
          position: lspPosition,
        }
      );

      const results = await this.processNavigationResponse(response, uri, maxResults);

      // Cache results
      if (results.length > 0) {
        await this.cache.set(cacheKey, results, uri);
      }

      return results;
    } catch (error) {
      this.logger.error({ error, uri, position, target }, 'Navigation request failed');
      throw error; // Re-throw to allow batch handling to detect the failure
    }
  }

  private getNavigationMethod(target: z.infer<typeof NavigateTargetSchema>): string {
    switch (target) {
      case 'definition':
        return 'textDocument/definition';
      case 'implementation':
        return 'textDocument/implementation';
      case 'typeDefinition':
        return 'textDocument/typeDefinition';
    }
  }

  private async processNavigationResponse(
    response: Location | Location[] | LocationLink[] | null,
    sourceUri: string,
    maxResults?: number
  ): Promise<NavigateResultItem[]> {
    if (!response) {
      return [];
    }

    // Normalize response to array
    const locations = Array.isArray(response) ? response : [response];

    // Convert to NavigateResultItem format
    const results = await Promise.all(locations.map((loc) => this.locationToResult(loc)));

    // Sort by relevance
    const sorted = this.sortByRelevance(results, sourceUri);

    // Apply limit
    return sorted.slice(0, maxResults || DEFAULT_MAX_RESULTS);
  }

  private async locationToResult(location: Location | LocationLink): Promise<NavigateResultItem> {
    // Handle LocationLink vs Location
    const isLocationLink = 'targetUri' in location;
    const uri = isLocationLink ? location.targetUri : location.uri;
    const range = isLocationLink ? location.targetSelectionRange : location.range;

    const result: NavigateResultItem = {
      uri,
      range: {
        start: {
          line: range.start.line,
          character: range.start.character,
        },
        end: {
          line: range.end.line,
          character: range.end.character,
        },
      },
    };

    // Try to get preview
    try {
      const preview = await this.getPreview(uri, range.start.line);
      if (preview) {
        result.preview = preview;
      }
    } catch (error) {
      // Preview is optional, don't fail if we can't get it
      this.logger.debug({ error, uri }, 'Failed to get preview');
    }

    return result;
  }

  private async getPreview(uri: string, line: number): Promise<string | undefined> {
    try {
      const filePath = fileURLToPath(uri);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      if (line >= 0 && line < lines.length) {
        return lines[line]?.trim();
      }
    } catch {
      // Ignore errors - preview is optional
    }
    return undefined;
  }

  private sortByRelevance(results: NavigateResultItem[], sourceUri: string): NavigateResultItem[] {
    const sourcePath = fileURLToPath(sourceUri);
    const sourceDir = dirname(sourcePath);

    return results.sort((a, b) => {
      const aPath = fileURLToPath(a.uri);
      const bPath = fileURLToPath(b.uri);

      // Same file first
      if (a.uri === sourceUri && b.uri !== sourceUri) return -1;
      if (b.uri === sourceUri && a.uri !== sourceUri) return 1;

      // Same directory second
      const aDir = dirname(aPath);
      const bDir = dirname(bPath);
      if (aDir === sourceDir && bDir !== sourceDir) return -1;
      if (bDir === sourceDir && aDir !== sourceDir) return 1;

      // By relative path distance
      const aRelative = relative(sourceDir, aPath);
      const bRelative = relative(sourceDir, bPath);
      const aDepth = aRelative.split('/').length;
      const bDepth = bRelative.split('/').length;

      return aDepth - bDepth;
    });
  }

  private getFallbackSuggestion(params: SingleNavigateParams): string {
    // TODO: Extract actual symbol name from file content at position
    // For now, using placeholder - this would require reading the file
    // and parsing the symbol at the given position
    const searchTerm = '<symbol>'; // Placeholder - symbol extraction not yet implemented

    const grepSuggestions: Record<string, string> = {
      definition: `Try: grep -n "function ${searchTerm}\\|class ${searchTerm}\\|const ${searchTerm}" **/*.{ts,js,py}`,
      implementation: `Try: grep -n "implements.*${searchTerm}\\|extends.*${searchTerm}" **/*.{ts,js,py}`,
      typeDefinition: `Try: grep -n "type ${searchTerm}\\|interface ${searchTerm}" **/*.{ts,js}`,
    };

    return (
      grepSuggestions[params.target] || `Try: grep -n "${searchTerm}" **/* to search for the symbol`
    );
  }

  /**
   * Clear navigation cache for a specific file
   */
  invalidateFileCache(fileUri: string): void {
    this.cache.invalidateFile(fileUri);
    this.logger.info({ fileUri }, 'Invalidated navigation cache for file');
  }

  /**
   * Clear all navigation cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cleared all navigation caches');
  }
}
