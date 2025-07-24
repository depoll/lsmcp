import { z } from 'zod';
import { BatchableTool } from './base.js';
import type { ConnectionPool } from '../lsp/manager.js';
import {
  SymbolKind,
  DocumentSymbol,
  SymbolInformation,
  type DocumentSymbolParams,
  type WorkspaceSymbolParams,
} from 'vscode-languageserver-protocol';
// Simple cache implementation to avoid LRU cache typing issues
interface CacheEntry<T> {
  value: T;
  expires: number;
}
import { createHash } from 'crypto';
import type { Logger } from 'pino';

// User-friendly symbol kinds
export const USER_SYMBOL_KINDS = [
  'function',
  'class',
  'interface',
  'variable',
  'constant',
  'method',
  'property',
  'enum',
] as const;

export type UserSymbolKind = (typeof USER_SYMBOL_KINDS)[number];

// Map LSP symbol kinds to user-friendly kinds
const KIND_MAP: Record<UserSymbolKind, SymbolKind[]> = {
  function: [SymbolKind.Function],
  class: [SymbolKind.Class],
  interface: [SymbolKind.Interface],
  variable: [SymbolKind.Variable],
  constant: [SymbolKind.Constant],
  method: [SymbolKind.Method, SymbolKind.Constructor],
  property: [SymbolKind.Property, SymbolKind.Field],
  enum: [SymbolKind.Enum, SymbolKind.EnumMember],
};

// Reverse map for converting LSP kinds to user kinds
const REVERSE_KIND_MAP: Map<SymbolKind, UserSymbolKind> = new Map();
for (const [userKind, lspKinds] of Object.entries(KIND_MAP)) {
  for (const lspKind of lspKinds) {
    REVERSE_KIND_MAP.set(lspKind, userKind as UserSymbolKind);
  }
}

export const symbolSearchParamsSchema = z.object({
  query: z.string().describe('Symbol name or pattern to search for'),
  scope: z.enum(['document', 'workspace']).describe('Search in current file or entire workspace'),
  uri: z.string().optional().describe('File URI (required for document scope)'),
  kind: z.enum(USER_SYMBOL_KINDS).optional().describe('Filter by symbol type'),
  maxResults: z.number().default(200).describe('Maximum number of results to return'),
});

export type SymbolSearchParams = z.infer<typeof symbolSearchParamsSchema>;

export interface SymbolResult {
  name: string;
  kind: UserSymbolKind;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
  score?: number;
}

export interface SymbolSearchResult {
  symbols: SymbolResult[];
  truncated?: boolean;
  totalFound?: number;
  error?: string;
  fallback?: string;
}

export class SymbolSearchTool extends BatchableTool<SymbolSearchParams, SymbolSearchResult> {
  readonly name = 'findSymbols';
  readonly description = 'Search for symbols in current file or entire workspace';
  get inputSchema(): z.ZodType<SymbolSearchParams> {
    return symbolSearchParamsSchema as unknown as z.ZodType<SymbolSearchParams>;
  }

  private cache = new Map<string, CacheEntry<SymbolSearchResult>>();
  private readonly cacheMaxSize = 100;
  private readonly cacheTTL = 1000 * 60 * 10; // 10 minutes

  constructor(manager: ConnectionPool, logger?: Logger) {
    super(manager);
    if (logger) {
      this.logger = logger;
    }
  }

  async execute(params: SymbolSearchParams): Promise<SymbolSearchResult> {
    // Validate params
    if (params.scope === 'document' && !params.uri) {
      throw new Error('uri is required for document scope');
    }

    // Check cache
    const cacheKey = this.getCacheKey(params);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger?.debug({ cacheKey }, 'Symbol search cache hit');
      return cached;
    }

    try {
      let symbols: SymbolResult[];

      if (params.scope === 'document') {
        symbols = await this.searchDocument(params);
      } else {
        symbols = await this.searchWorkspace(params);
      }

      // Apply fuzzy matching and scoring
      const scored = this.scoreAndFilter(symbols, params.query);

      // Filter by kind if specified
      const filtered = params.kind ? scored.filter((s) => s.kind === params.kind) : scored;

      // Sort by score and limit results
      const sorted = filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
      const limited = sorted.slice(0, params.maxResults);

      const result: SymbolSearchResult = {
        symbols: limited,
        truncated: sorted.length > params.maxResults,
        totalFound: sorted.length,
      };

      this.setInCache(cacheKey, result);
      return result;
    } catch (error) {
      this.logger?.error({ error, params }, 'Symbol search failed');

      // Provide fallback suggestions
      const fallback = this.generateFallback(params);

      return {
        symbols: [],
        error: `Failed to search symbols: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fallback,
      };
    }
  }

  async batchExecute(params: SymbolSearchParams[]): Promise<SymbolSearchResult[]> {
    // Group by scope and URI for more efficient batching
    const documentSearches = params.filter((p) => p.scope === 'document');
    const workspaceSearches = params.filter((p) => p.scope === 'workspace');

    const results = await Promise.all([
      ...documentSearches.map((p) => this.execute(p)),
      ...workspaceSearches.map((p) => this.execute(p)),
    ]);

    return results;
  }

  private async searchDocument(params: SymbolSearchParams): Promise<SymbolResult[]> {
    // Extract workspace from URI using proper URL parsing
    const workspace = this.extractWorkspaceFromUri(params.uri!);
    const language = this.detectLanguage(params.uri!);
    const client = await this.clientManager.get(language, workspace);

    const docParams: DocumentSymbolParams = {
      textDocument: { uri: params.uri! },
    };

    const response = await client.sendRequest<DocumentSymbol[] | SymbolInformation[] | null>(
      'textDocument/documentSymbol',
      docParams
    );

    if (!response) {
      return [];
    }

    // Response can be either DocumentSymbol[] or SymbolInformation[]
    if (Array.isArray(response) && response.length > 0) {
      const firstItem = response[0];
      if (firstItem && 'children' in firstItem) {
        // DocumentSymbol[] - hierarchical
        return this.flattenDocumentSymbols(response as DocumentSymbol[], params.uri!);
      } else {
        // SymbolInformation[] - flat
        return this.convertSymbolInformation(response as SymbolInformation[]);
      }
    }

    return [];
  }

  private async searchWorkspace(params: SymbolSearchParams): Promise<SymbolResult[]> {
    // For workspace search, we need to use a default language/workspace
    // In a real implementation, this would be more sophisticated
    const workspace = process.cwd();
    const language = await this.detectWorkspaceLanguage();
    const client = await this.clientManager.get(language, workspace);

    const wsParams: WorkspaceSymbolParams = {
      query: params.query,
    };

    const response = await client.sendRequest<SymbolInformation[] | null>(
      'workspace/symbol',
      wsParams
    );

    if (!response || !Array.isArray(response)) {
      return [];
    }

    return this.convertSymbolInformation(response);
  }

  private flattenDocumentSymbols(
    symbols: DocumentSymbol[],
    uri: string,
    container?: string,
    depth = 0
  ): SymbolResult[] {
    const results: SymbolResult[] = [];

    for (const symbol of symbols) {
      const userKind = REVERSE_KIND_MAP.get(symbol.kind) || 'variable';

      results.push({
        name: symbol.name,
        kind: userKind,
        location: {
          uri,
          range: symbol.range,
        },
        ...(container && { containerName: container }),
      });

      if (symbol.children && symbol.children.length > 0 && depth < 10) {
        results.push(...this.flattenDocumentSymbols(symbol.children, uri, symbol.name, depth + 1));
      }
    }

    return results;
  }

  private convertSymbolInformation(symbols: SymbolInformation[]): SymbolResult[] {
    return symbols.map((symbol) => {
      const userKind = REVERSE_KIND_MAP.get(symbol.kind) || 'variable';

      return {
        name: symbol.name,
        kind: userKind,
        location: symbol.location,
        ...(symbol.containerName && { containerName: symbol.containerName }),
      };
    });
  }

  private scoreAndFilter(symbols: SymbolResult[], query: string): SymbolResult[] {
    // Handle special patterns
    if (query.includes('*')) {
      return this.patternMatch(symbols, query);
    }

    // Score each symbol
    return symbols
      .map((symbol) => ({
        ...symbol,
        score: this.fuzzyMatch(query, symbol.name),
      }))
      .filter((s) => s.score && s.score > 0);
  }

  private patternMatch(symbols: SymbolResult[], pattern: string): SymbolResult[] {
    // Convert pattern to regex
    let regex: RegExp;

    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      // *substring*
      const substring = this.escapeRegExp(pattern.slice(1, -1));
      regex = new RegExp(substring, 'i');
    } else if (pattern.endsWith('*')) {
      // prefix*
      const prefix = this.escapeRegExp(pattern.slice(0, -1));
      regex = new RegExp(`^${prefix}`, 'i');
    } else if (pattern.startsWith('*')) {
      // *suffix
      const suffix = this.escapeRegExp(pattern.slice(1));
      regex = new RegExp(`${suffix}$`, 'i');
    } else {
      // Treat as substring
      regex = new RegExp(this.escapeRegExp(pattern.replace(/\*/g, '')), 'i');
    }

    return symbols
      .filter((s) => regex.test(s.name))
      .map((s) => ({
        ...s,
        score: 100, // High score for pattern matches
      }));
  }

  private fuzzyMatch(query: string, symbol: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerSymbol = symbol.toLowerCase();

    // Exact match
    if (lowerQuery === lowerSymbol) return 100;

    // Prefix match
    if (lowerSymbol.startsWith(lowerQuery)) return 80;

    // CamelCase match
    const capitals = symbol.match(/[A-Z]/g) || [];
    const camelAbbrev = capitals.join('').toLowerCase();
    const firstPlusCaps = ((symbol[0] || '') + capitals.join('')).toLowerCase();

    if (camelAbbrev === lowerQuery || firstPlusCaps === lowerQuery) return 70;
    if (camelAbbrev.includes(lowerQuery) || firstPlusCaps.includes(lowerQuery)) return 65;

    // Substring match
    if (lowerSymbol.includes(lowerQuery)) return 50;

    return 0;
  }

  private generateFallback(params: SymbolSearchParams): string {
    const commands: string[] = [];

    if (params.scope === 'document' && params.uri) {
      const path = params.uri.replace('file://', '');
      if (params.kind === 'class') {
        commands.push(`grep -n "class.*${params.query}" "${path}"`);
      } else if (params.kind === 'function') {
        commands.push(`grep -n "function.*${params.query}\\|def.*${params.query}" "${path}"`);
      } else {
        commands.push(`grep -n "${params.query}" "${path}"`);
      }
    } else {
      // Workspace search
      if (params.kind === 'class') {
        commands.push(
          `grep -r "class.*${params.query}" --include="*.ts" --include="*.js" --include="*.py"`
        );
      } else if (params.kind === 'function') {
        commands.push(
          `grep -r "function.*${params.query}\\|def.*${params.query}" --include="*.ts" --include="*.js" --include="*.py"`
        );
      } else {
        commands.push(
          `grep -r "${params.query}" --include="*.ts" --include="*.js" --include="*.py"`
        );
      }
    }

    return `Try using filesystem search instead:\n${commands.join('\n')}`;
  }

  private getCacheKey(params: SymbolSearchParams): string {
    const key = JSON.stringify({
      query: params.query,
      scope: params.scope,
      uri: params.uri,
      kind: params.kind,
    });
    return createHash('sha256').update(key).digest('hex');
  }

  private getFromCache(key: string): SymbolSearchResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  private setInCache(key: string, value: SymbolSearchResult): void {
    // Enforce max size
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + this.cacheTTL,
    });
  }

  private detectLanguage(uri: string): string {
    const ext = uri.substring(uri.lastIndexOf('.'));
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.py':
        return 'python';
      case '.rs':
        return 'rust';
      case '.go':
        return 'go';
      case '.java':
        return 'java';
      case '.cpp':
      case '.cc':
      case '.cxx':
        return 'cpp';
      case '.c':
        return 'c';
      case '.rb':
        return 'ruby';
      case '.php':
        return 'php';
      default:
        return 'typescript'; // Default fallback
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractWorkspaceFromUri(uri: string): string {
    try {
      // Handle file:// URIs
      if (uri.startsWith('file://')) {
        const filePath = uri.substring(7); // Remove 'file://'
        // On Windows, remove leading slash if it's a drive letter
        const normalizedPath =
          filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)
            ? filePath.substring(1)
            : filePath;

        const lastSlash = normalizedPath.lastIndexOf('/');
        const lastBackslash = normalizedPath.lastIndexOf('\\');
        const lastSeparator = Math.max(lastSlash, lastBackslash);

        return lastSeparator > 0 ? normalizedPath.substring(0, lastSeparator) : process.cwd();
      }

      // For other URI schemes, attempt basic parsing
      const lastSlash = uri.lastIndexOf('/');
      return lastSlash > 0 ? uri.substring(0, lastSlash) : process.cwd();
    } catch (error) {
      this.logger?.warn(
        { error, uri },
        'Failed to extract workspace from URI, using current directory'
      );
      return process.cwd();
    }
  }

  private async detectWorkspaceLanguage(): Promise<string> {
    // Check for common configuration files to detect project language
    const fs = await import('fs/promises');
    const path = await import('path');
    const workspace = process.cwd();

    try {
      // Check for TypeScript/JavaScript
      const tsConfigExists = await fs
        .access(path.join(workspace, 'tsconfig.json'))
        .then(() => true)
        .catch(() => false);
      if (tsConfigExists) return 'typescript';

      const packageJsonExists = await fs
        .access(path.join(workspace, 'package.json'))
        .then(() => true)
        .catch(() => false);
      if (packageJsonExists) return 'javascript';

      // Check for Python
      const pyProjectExists = await fs
        .access(path.join(workspace, 'pyproject.toml'))
        .then(() => true)
        .catch(() => false);
      const setupPyExists = await fs
        .access(path.join(workspace, 'setup.py'))
        .then(() => true)
        .catch(() => false);
      if (pyProjectExists || setupPyExists) return 'python';

      // Check for Rust
      const cargoExists = await fs
        .access(path.join(workspace, 'Cargo.toml'))
        .then(() => true)
        .catch(() => false);
      if (cargoExists) return 'rust';

      // Check for Go
      const goModExists = await fs
        .access(path.join(workspace, 'go.mod'))
        .then(() => true)
        .catch(() => false);
      if (goModExists) return 'go';

      // Check for Java
      const pomExists = await fs
        .access(path.join(workspace, 'pom.xml'))
        .then(() => true)
        .catch(() => false);
      const gradleExists = await fs
        .access(path.join(workspace, 'build.gradle'))
        .then(() => true)
        .catch(() => false);
      if (pomExists || gradleExists) return 'java';

      // Default to TypeScript if no specific indicators found
      return 'typescript';
    } catch (error) {
      this.logger?.warn({ error }, 'Failed to detect workspace language, defaulting to TypeScript');
      return 'typescript';
    }
  }
}
