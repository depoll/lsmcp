import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import {
  Hover,
  Position,
  MarkupKind,
  SymbolKind,
  DocumentSymbol,
  Location,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { FileAwareLRUCache } from '../utils/fileCache.js';
import { getLanguageFromUri } from '../utils/languages.js';
import { retryWithBackoff } from '../utils/retry.js';
import { StandardResult, ToolAnnotations } from './common-types.js';
import { FILE_URI_DESCRIPTION } from './file-uri-description.js';
import { SYMBOL_POSITION_DESCRIPTION } from './position-schema.js';
import type { LSPClient } from '../lsp/client-v2.js';
import { marked } from 'marked';

/**
 * Map LSP SymbolKind to user-friendly string.
 * Language-agnostic: uses the standard LSP symbol kinds.
 */
const SYMBOL_KIND_MAP: Record<number, string> = {
  [SymbolKind.File]: 'file',
  [SymbolKind.Module]: 'module',
  [SymbolKind.Namespace]: 'namespace',
  [SymbolKind.Package]: 'package',
  [SymbolKind.Class]: 'class',
  [SymbolKind.Method]: 'method',
  [SymbolKind.Property]: 'property',
  [SymbolKind.Field]: 'field',
  [SymbolKind.Constructor]: 'constructor',
  [SymbolKind.Enum]: 'enum',
  [SymbolKind.Interface]: 'interface',
  [SymbolKind.Function]: 'function',
  [SymbolKind.Variable]: 'variable',
  [SymbolKind.Constant]: 'constant',
  [SymbolKind.String]: 'string',
  [SymbolKind.Number]: 'number',
  [SymbolKind.Boolean]: 'boolean',
  [SymbolKind.Array]: 'array',
  [SymbolKind.Object]: 'object',
  [SymbolKind.Key]: 'key',
  [SymbolKind.Null]: 'null',
  [SymbolKind.EnumMember]: 'enumMember',
  [SymbolKind.Struct]: 'struct',
  [SymbolKind.Event]: 'event',
  [SymbolKind.Operator]: 'operator',
  [SymbolKind.TypeParameter]: 'typeParameter',
};

// Configuration constants
const CACHE_SIZE = 200;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_SYMBOLS = 50;

/**
 * Schema for a single symbol location
 */
const SymbolLocationSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: z
    .object({
      line: z
        .number()
        .min(0)
        .describe(
          'Zero-based line number. The first line in a file is line 0. ' +
            'Example: line 0 = first line, line 10 = eleventh line.'
        ),
      character: z
        .number()
        .min(0)
        .describe(
          'Zero-based character offset within the line. ' +
            'This counts UTF-16 code units (same as JavaScript string indexing).'
        ),
    })
    .describe(SYMBOL_POSITION_DESCRIPTION),
  name: z.string().optional().describe('Optional symbol name for context and deduplication'),
});

/**
 * Schema for getDocs tool parameters
 */
const GetDocsParamsSchema = z.object({
  symbols: z
    .array(SymbolLocationSchema)
    .min(1)
    .max(100)
    .describe(
      'List of symbols to retrieve documentation for. Each symbol is identified by its file URI and position.'
    ),
  maxDepth: z
    .number()
    .min(0)
    .max(5)
    .default(DEFAULT_MAX_DEPTH)
    .optional()
    .describe(
      'Maximum depth for traversing related types (0 = no traversal, just direct docs). ' +
        'Higher values find more related API docs but increase response size. Default: 3'
    ),
  maxSymbols: z
    .number()
    .min(1)
    .max(200)
    .default(DEFAULT_MAX_SYMBOLS)
    .optional()
    .describe(
      'Maximum number of symbols to return (limits breadth of traversal). ' +
        'Default: 50. Use lower values for focused results, higher for comprehensive docs.'
    ),
  includePrivate: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      'Include private/internal symbols (those starting with _ or #). ' +
        'Default: false for cleaner API docs.'
    ),
});

type GetDocsParams = z.infer<typeof GetDocsParamsSchema>;

/**
 * Documentation for a single symbol
 */
interface SymbolDoc {
  /** Symbol name (e.g., function name, class name) */
  name: string;
  /** Symbol type/signature (e.g., "(a: string, b: number) => void") */
  signature?: string;
  /** Documentation text (JSDoc, docstrings, etc.) */
  documentation?: string;
  /** Symbol kind (function, class, interface, variable, etc.) */
  kind?: string;
  /** File URI where the symbol is defined */
  uri: string;
  /** Position in the file */
  position: { line: number; character: number };
  /** Related symbols discovered during traversal */
  relatedTypes?: string[];
  /** Depth at which this symbol was discovered (0 = direct query) */
  depth: number;
}

/**
 * Result data for getDocs tool
 */
interface GetDocsResultData {
  /** Array of symbol documentation objects */
  symbols: SymbolDoc[];
  /** Summary statistics */
  stats: {
    /** Number of symbols queried */
    queried: number;
    /** Number of symbols with documentation found */
    found: number;
    /** Maximum depth reached during traversal */
    maxDepthReached: number;
    /** Whether results were truncated due to maxSymbols limit */
    truncated: boolean;
  };
}

type GetDocsResult = StandardResult<GetDocsResultData>;

/**
 * GetDocsTool - Retrieves documentation for a list of symbols using LSP.
 *
 * This tool allows AI coding agents to efficiently gather API documentation
 * for symbols currently in scope. It traverses related types to a configurable
 * depth, accumulating signatures and documentation comments.
 *
 * @example
 * ```typescript
 * const result = await tool.execute({
 *   symbols: [
 *     { uri: 'file:///src/api.ts', position: { line: 10, character: 5 } },
 *     { uri: 'file:///src/types.ts', position: { line: 20, character: 10 } }
 *   ],
 *   maxDepth: 3,
 *   maxSymbols: 50
 * });
 * ```
 */
export class GetDocsTool extends BatchableTool<GetDocsParams, GetDocsResult> {
  readonly name = 'getDocs';
  readonly description = `Retrieve API documentation for symbols, with depth-based traversal of related types.

Input: List of symbols (uri + position), outputs their signatures and documentation.

Use cases:
- Get up-to-date API docs for functions/classes in scope
- Explore type hierarchies and related interfaces
- Build context for code generation tasks

Features: Depth traversal, caching, deduplication, private symbol filtering.`;

  readonly inputSchema = GetDocsParamsSchema;

  /** Output schema for MCP tool discovery */
  readonly outputSchema = z.object({
    data: z.object({
      symbols: z.array(
        z.object({
          name: z.string(),
          signature: z.string().optional(),
          documentation: z.string().optional(),
          kind: z.string().optional(),
          uri: z.string(),
          position: z.object({
            line: z.number(),
            character: z.number(),
          }),
          relatedTypes: z.array(z.string()).optional(),
          depth: z.number(),
        })
      ),
      stats: z.object({
        queried: z.number(),
        found: z.number(),
        maxDepthReached: z.number(),
        truncated: z.boolean(),
      }),
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
    title: 'Get Documentation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  private cache: FileAwareLRUCache<SymbolDoc>;

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
    this.cache = new FileAwareLRUCache<SymbolDoc>(CACHE_SIZE, CACHE_TTL);
  }

  async execute(params: GetDocsParams): Promise<GetDocsResult> {
    const startTime = Date.now();
    const maxDepth = params.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxSymbols = params.maxSymbols ?? DEFAULT_MAX_SYMBOLS;
    const includePrivate = params.includePrivate ?? false;

    this.logger.info(
      { symbolCount: params.symbols.length, maxDepth, maxSymbols },
      'Executing getDocs request'
    );

    try {
      // Track visited symbols to avoid duplicates
      const visited = new Set<string>();
      const results: SymbolDoc[] = [];
      let maxDepthReached = 0;

      // Queue for breadth-first traversal
      const queue: Array<{
        uri: string;
        position: { line: number; character: number };
        name?: string;
        depth: number;
      }> = params.symbols.map((s) => ({ ...s, depth: 0 }));

      while (queue.length > 0 && results.length < maxSymbols) {
        const current = queue.shift()!;

        // Skip if we've exceeded max depth
        if (current.depth > maxDepth) {
          continue;
        }

        // Create unique key for this symbol
        const key = this.createSymbolKey(current.uri, current.position);
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);

        // Get documentation for this symbol
        const doc = await this.getSymbolDoc(
          current.uri,
          current.position,
          current.name,
          current.depth
        );

        if (!doc) {
          continue;
        }

        // Filter private symbols if requested
        if (!includePrivate && this.isPrivateSymbol(doc.name)) {
          continue;
        }

        results.push(doc);
        maxDepthReached = Math.max(maxDepthReached, current.depth);

        // If we haven't reached max depth, queue related types for traversal
        if (current.depth < maxDepth && doc.relatedTypes && doc.relatedTypes.length > 0) {
          // Extract type references from the documentation/signature
          const relatedPositions = await this.findRelatedTypePositions(
            current.uri,
            doc.relatedTypes
          );

          for (const related of relatedPositions) {
            const relatedKey = this.createSymbolKey(related.uri, related.position);
            if (!visited.has(relatedKey) && results.length + queue.length < maxSymbols) {
              queue.push({
                uri: related.uri,
                position: related.position,
                name: related.name,
                depth: current.depth + 1,
              });
            }
          }
        }
      }

      const truncated = results.length >= maxSymbols || queue.length > 0;

      return {
        data: {
          symbols: results,
          stats: {
            queried: params.symbols.length,
            found: results.length,
            maxDepthReached,
            truncated,
          },
        },
        metadata: {
          processingTime: Date.now() - startTime,
          cached: false, // Individual items may be cached
        },
      };
    } catch (error) {
      this.logger.error({ error, params }, 'getDocs request failed');

      return {
        data: {
          symbols: [],
          stats: {
            queried: params.symbols.length,
            found: 0,
            maxDepthReached: 0,
            truncated: false,
          },
        },
        metadata: {
          processingTime: Date.now() - startTime,
          cached: false,
        },
        error: error instanceof Error ? error.message : String(error),
        fallback: this.getFallbackSuggestion(params),
      };
    }
  }

  /**
   * Get documentation for a single symbol at the given position.
   * Uses LSP to get symbol information (kind, name) and hover for documentation.
   */
  private async getSymbolDoc(
    uri: string,
    position: { line: number; character: number },
    name?: string,
    depth: number = 0
  ): Promise<SymbolDoc | null> {
    const cacheKey = `${uri}:${position.line}:${position.character}`;
    const cached = await this.cache.get(cacheKey, uri);
    if (cached) {
      this.logger.debug({ uri, position }, 'getDocs cache hit');
      return { ...cached, depth };
    }

    // Get LSP client for this file
    const workspace = this.extractWorkspaceFromUri(uri);
    const client = await this.clientManager.getForFile(uri, workspace);

    if (!client) {
      this.logger.warn({ uri }, 'Failed to get language client for file');
      return null;
    }

    // Ensure the file is opened in the language server (works for all languages)
    const language = getLanguageFromUri(uri);
    await this.ensureFileOpened(client, uri, language);

    const lspPosition: Position = {
      line: position.line,
      character: position.character,
    };

    // First, try to get symbol information from document symbols (LSP-native approach)
    const symbolInfo = await this.getSymbolAtPosition(client, uri, position);

    // Get hover information for documentation and signature
    const hover = await retryWithBackoff(
      async () => {
        const result = await client.sendRequest<Hover | null>('textDocument/hover', {
          textDocument: { uri },
          position: lspPosition,
        });

        if (!result || !result.contents) {
          throw new Error('No hover information available - possible indexing lag');
        }

        return result;
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoffMultiplier: 2,
        shouldRetry: (error: unknown) => {
          if (error instanceof Error) {
            return error.message.includes('No hover information');
          }
          return false;
        },
        onRetry: (error: unknown, attempt: number) => {
          this.logger.info(
            { error, uri, position, attempt },
            'Retrying hover due to possible indexing lag'
          );
        },
      }
    ).catch(() => null);

    if (!hover) {
      return null;
    }

    // Get related types by using textDocument/definition to find type definitions
    const relatedTypes = await this.findRelatedTypesViaDefinition(client, uri, position);

    // Parse the hover response, using symbol info from LSP when available
    const doc = this.parseHoverToDoc(hover, uri, position, name, depth, symbolInfo, relatedTypes);

    if (doc) {
      // Cache without depth (depth is added when retrieved)
      await this.cache.set(cacheKey, { ...doc, depth: 0 }, uri);
    }

    return doc;
  }

  /**
   * Get symbol information at a specific position using LSP document symbols.
   * This provides language-agnostic kind and name extraction.
   */
  private async getSymbolAtPosition(
    client: LSPClient,
    uri: string,
    position: { line: number; character: number }
  ): Promise<{ name: string; kind: string } | null> {
    try {
      // Get all symbols in the document
      const symbols = await client.sendRequest<DocumentSymbol[] | null>(
        'textDocument/documentSymbol',
        { textDocument: { uri } }
      );

      if (!symbols || symbols.length === 0) {
        return null;
      }

      // Find the symbol that contains or is at the given position
      const symbol = this.findSymbolAtPosition(symbols, position);
      if (symbol) {
        return {
          name: symbol.name,
          kind: SYMBOL_KIND_MAP[symbol.kind] || 'unknown',
        };
      }

      return null;
    } catch (error) {
      this.logger.debug({ error, uri, position }, 'Failed to get document symbols');
      return null;
    }
  }

  /**
   * Find a symbol at a specific position in the document symbol tree.
   */
  private findSymbolAtPosition(
    symbols: DocumentSymbol[],
    position: { line: number; character: number }
  ): DocumentSymbol | null {
    for (const symbol of symbols) {
      // Check if position is within this symbol's range
      if (this.isPositionInRange(position, symbol.range)) {
        // Check children first for more specific match
        if (symbol.children && symbol.children.length > 0) {
          const childMatch = this.findSymbolAtPosition(symbol.children, position);
          if (childMatch) {
            return childMatch;
          }
        }
        // Return this symbol if position is at or near the selection range
        if (this.isPositionInRange(position, symbol.selectionRange)) {
          return symbol;
        }
        // Fall back to this symbol if no better match found
        return symbol;
      }
    }
    return null;
  }

  /**
   * Check if a position is within a range.
   */
  private isPositionInRange(
    position: { line: number; character: number },
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
  ): boolean {
    if (position.line < range.start.line || position.line > range.end.line) {
      return false;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
      return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
      return false;
    }
    return true;
  }

  /**
   * Find related types by using textDocument/definition to navigate to type definitions.
   * This is language-agnostic and relies entirely on the LSP.
   */
  private async findRelatedTypesViaDefinition(
    client: LSPClient,
    uri: string,
    position: { line: number; character: number }
  ): Promise<string[]> {
    const relatedTypes: string[] = [];

    try {
      // Use textDocument/definition to find where the symbol is defined
      const definitions = await client.sendRequest<Location | Location[] | LocationLink[] | null>(
        'textDocument/definition',
        {
          textDocument: { uri },
          position: { line: position.line, character: position.character },
        }
      );

      if (!definitions) {
        return relatedTypes;
      }

      // Normalize to array
      const defArray = Array.isArray(definitions) ? definitions : [definitions];

      for (const def of defArray) {
        // Handle both Location and LocationLink
        const defUri = 'targetUri' in def ? def.targetUri : def.uri;
        const defRange = 'targetRange' in def ? def.targetRange : def.range;

        // Skip if same location (pointing to itself)
        if (defUri === uri && defRange.start.line === position.line) {
          continue;
        }

        // Get symbol info at the definition location
        const defSymbol = await this.getSymbolAtPosition(client, defUri, defRange.start);
        if (defSymbol && defSymbol.name && !relatedTypes.includes(defSymbol.name)) {
          relatedTypes.push(defSymbol.name);
        }
      }
    } catch (error) {
      this.logger.debug({ error, uri, position }, 'Failed to find definitions for related types');
    }

    return relatedTypes;
  }

  /**
   * Parse LSP Hover response into SymbolDoc format.
   * Uses LSP-provided symbol info when available, falls back to signature extraction.
   */
  private parseHoverToDoc(
    hover: Hover,
    uri: string,
    position: { line: number; character: number },
    providedName?: string,
    depth: number = 0,
    symbolInfo?: { name: string; kind: string } | null,
    lspRelatedTypes?: string[]
  ): SymbolDoc | null {
    if (!hover.contents) {
      return null;
    }

    let signature: string | undefined;
    let documentation: string | undefined;
    // Use LSP-provided kind if available
    let kind: string | undefined = symbolInfo?.kind;
    // Use LSP-provided name, then providedName, then 'unknown'
    let name = symbolInfo?.name || providedName || 'unknown';
    // Use LSP-provided related types
    const relatedTypes: string[] = lspRelatedTypes ? [...lspRelatedTypes] : [];

    // Handle different content formats
    if (typeof hover.contents === 'string') {
      // Plain string content
      documentation = hover.contents;
    } else if ('kind' in hover.contents) {
      // MarkupContent
      const text = hover.contents.value;

      if (hover.contents.kind === MarkupKind.Markdown) {
        // Parse markdown to extract signature and documentation
        const parsed = this.parseMarkdownContent(text);
        signature = parsed.signature;
        documentation = parsed.documentation;
        // Only use parsed kind/name if LSP didn't provide them
        if (!kind && parsed.kind) kind = parsed.kind;
        if (name === 'unknown' && parsed.name) name = parsed.name;
      } else {
        documentation = text;
      }
    } else if (Array.isArray(hover.contents)) {
      // Array of MarkedString
      for (const item of hover.contents) {
        if (typeof item === 'string') {
          documentation = (documentation || '') + '\n' + item;
        } else if ('language' in item) {
          // Code block - likely the signature
          signature = item.value;
        }
      }
    }

    // Last resort: try to extract name from signature if still unknown
    if (name === 'unknown' && signature) {
      const extractedName = this.extractNameFromSignature(signature);
      if (extractedName) {
        name = extractedName;
      }
    }

    // Extract type references from signature to find related types
    if (signature) {
      const signatureTypes = this.extractTypesFromSignature(signature);
      for (const typeName of signatureTypes) {
        if (!relatedTypes.includes(typeName)) {
          relatedTypes.push(typeName);
        }
      }
    }

    return {
      name,
      signature,
      documentation: documentation?.trim(),
      kind,
      uri,
      position,
      relatedTypes: relatedTypes.length > 0 ? relatedTypes : undefined,
      depth,
    };
  }

  /**
   * Extract type names from a signature string.
   * Finds PascalCase identifiers that are likely custom types.
   */
  private extractTypesFromSignature(signature: string): string[] {
    const types: string[] = [];

    // Common built-in types to exclude (language-agnostic)
    const builtinTypes = new Set([
      // JS/TS
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
      'Map', 'Set', 'Date', 'RegExp', 'Error', 'Symbol',
      // Primitives
      'string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'unknown', 'never',
      'true', 'false', 'int', 'float', 'double', 'char', 'byte', 'long', 'short',
      // Python
      'None', 'True', 'False', 'List', 'Dict', 'Tuple', 'Optional', 'Union', 'Callable',
      // Rust
      'Vec', 'Box', 'Option', 'Result', 'Rc', 'Arc', 'Self',
      // Go
      'error', 'interface',
      // Generic
      'T', 'K', 'V', 'E', 'R', 'S', 'U',
    ]);

    // Match PascalCase identifiers (likely custom types)
    const typePattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;
    let match;

    while ((match = typePattern.exec(signature)) !== null) {
      const typeName = match[1];
      if (typeName && !builtinTypes.has(typeName) && !types.includes(typeName)) {
        types.push(typeName);
      }
    }

    return types;
  }

  /**
   * Parse markdown content from hover to extract signature and documentation.
   * Kind and name extraction is now handled by LSP document symbols.
   * This method is a fallback when LSP doesn't provide symbol information.
   */
  private parseMarkdownContent(text: string): {
    signature?: string;
    documentation?: string;
    kind?: string;
    name?: string;
  } {
    let signature: string | undefined;
    let documentation: string | undefined;
    let kind: string | undefined;
    let name: string | undefined;

    try {
      const tokens = marked.lexer(text);

      for (const token of tokens) {
        if (token.type === 'code' && 'text' in token && token.text) {
          // Code block usually contains the signature
          if (!signature) {
            signature = String(token.text).trim();

            // Fallback: try to extract kind and name from signature if LSP didn't provide them
            const parsed = this.extractKindAndNameFromSignature(signature);
            if (parsed.kind) kind = parsed.kind;
            if (parsed.name) name = parsed.name;
          }
        } else if (token.type === 'paragraph' || token.type === 'text') {
          // Paragraph is documentation
          const raw = 'raw' in token ? String(token.raw) : '';
          if (raw) {
            documentation = (documentation || '') + raw;
          }
        }
      }
    } catch (error) {
      // If markdown parsing fails, treat the whole thing as documentation
      this.logger.debug({ error }, 'Markdown parsing failed, using raw text');
      documentation = text;
    }

    return {
      signature,
      documentation: documentation?.trim(),
      kind,
      name,
    };
  }

  /**
   * Extract kind and name from a signature string.
   * This is a fallback when LSP document symbols don't provide this information.
   * Uses simple heuristics that work across languages without language-specific parsing.
   */
  private extractKindAndNameFromSignature(signature: string): { kind?: string; name?: string } {
    // Simple heuristic patterns that work across most languages
    // These are intentionally minimal - LSP document symbols are preferred
    const patterns = [
      // Function-like patterns (common across languages)
      { regex: /^\s*(?:async\s+)?(?:function|func|fn|def)\s+(\w+)/, kind: 'function', nameGroup: 1 },
      // Class-like patterns
      { regex: /^\s*(?:class|struct|type)\s+(\w+)/, kind: 'class', nameGroup: 1 },
      // Interface/trait patterns
      { regex: /^\s*(?:interface|trait|protocol)\s+(\w+)/, kind: 'interface', nameGroup: 1 },
      // Generic name extraction (last resort)
      { regex: /^\s*(?:const|let|var|val)?\s*(\w+)\s*[=:]/, kind: 'variable', nameGroup: 1 },
    ];

    for (const pattern of patterns) {
      const match = signature.match(pattern.regex);
      const capturedName = match?.[pattern.nameGroup];
      if (match && capturedName) {
        return {
          kind: pattern.kind,
          name: capturedName,
        };
      }
    }

    return {};
  }

  /**
   * Extract the symbol name from a signature (fallback when LSP doesn't provide it).
   */
  private extractNameFromSignature(signature: string): string | undefined {
    const parsed = this.extractKindAndNameFromSignature(signature);
    return parsed.name;
  }

  /**
   * Find positions of related type definitions in the workspace.
   * Uses workspace/symbol LSP request to find type definitions.
   */
  private async findRelatedTypePositions(
    sourceUri: string,
    typeNames: string[]
  ): Promise<Array<{ uri: string; position: { line: number; character: number }; name: string }>> {
    const results: Array<{
      uri: string;
      position: { line: number; character: number };
      name: string;
    }> = [];

    // Get workspace and client
    const workspace = this.extractWorkspaceFromUri(sourceUri);
    const client = await this.clientManager.getForFile(sourceUri, workspace);

    if (!client) {
      return results;
    }

    // Use workspace symbol search to find type definitions
    for (const typeName of typeNames) {
      try {
        const symbols = await client.sendRequest<
          Array<{
            name: string;
            kind: number;
            location: { uri: string; range: { start: { line: number; character: number } } };
          }> | null
        >('workspace/symbol', { query: typeName });

        if (symbols && symbols.length > 0) {
          // Find exact match (or close match)
          const exactMatch = symbols.find((s) => s.name === typeName);
          const symbol = exactMatch || symbols[0];

          if (symbol) {
            results.push({
              uri: symbol.location.uri,
              position: symbol.location.range.start,
              name: symbol.name,
            });
          }
        }
      } catch (error) {
        this.logger.debug({ error, typeName }, 'Failed to find related type');
      }
    }

    return results;
  }

  /**
   * Create a unique key for a symbol location
   */
  private createSymbolKey(
    uri: string,
    position: { line: number; character: number }
  ): string {
    return `${uri}:${position.line}:${position.character}`;
  }

  /**
   * Check if a symbol name indicates a private/internal symbol
   */
  private isPrivateSymbol(name: string): boolean {
    return name.startsWith('_') || name.startsWith('#');
  }

  /**
   * Extract workspace directory from URI
   */
  private extractWorkspaceFromUri(uri: string): string {
    try {
      const url = new URL(uri);
      if (url.protocol === 'file:') {
        const filePath = decodeURIComponent(url.pathname);
        const lastSlash = filePath.lastIndexOf('/');
        return lastSlash > 0 ? filePath.substring(0, lastSlash) : process.cwd();
      }
      return process.cwd();
    } catch {
      return process.cwd();
    }
  }

  /**
   * Ensure file is opened in language server
   */
  private async ensureFileOpened(
    client: LSPClient,
    uri: string,
    language: string
  ): Promise<void> {
    try {
      const filePath = uri.replace('file://', '');
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');

      client.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: language,
          version: 1,
          text: content,
        },
      });

      // Give the server a moment to process
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      this.logger.warn({ error, uri }, 'Failed to open document for getDocs');
    }
  }

  /**
   * Generate fallback suggestion when documentation retrieval fails.
   * Language-agnostic: provides generic grep pattern.
   */
  private getFallbackSuggestion(params: GetDocsParams): string {
    const symbolCount = params.symbols.length;
    const sampleUri = params.symbols[0]?.uri || '';
    const filename = sampleUri.split('/').pop() || 'file';

    return (
      `Failed to retrieve docs for ${symbolCount} symbol(s). ` +
      `Try: grep -n "def \\|fn \\|func \\|function \\|class \\|struct \\|interface " ${filename} ` +
      `to find symbol definitions manually.`
    );
  }

  /**
   * Invalidate cache entries for a specific file
   */
  invalidateFileCache(fileUri: string): void {
    this.cache.invalidateFile(fileUri);
    this.logger.info({ fileUri }, 'Invalidated getDocs cache for file');
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cleared all getDocs caches');
  }
}
