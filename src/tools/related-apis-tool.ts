import { z } from 'zod';
import { BatchableTool } from './base.js';
import type { ConnectionPool } from '../lsp/manager.js';
import {
  Hover,
  SymbolInformation,
  SymbolKind,
  WorkspaceSymbolParams,
  MarkupKind,
} from 'vscode-languageserver-protocol';
import { StandardResult, MCPError, MCPErrorCode, ToolAnnotations } from './common-types.js';
import { marked } from 'marked';
import type { Logger } from 'pino';
import { retryWithBackoff } from '../utils/retry.js';

// Schema for the tool parameters
export const relatedAPIsParamsSchema = z.object({
  symbols: z
    .array(z.string())
    .min(1)
    .describe('Array of symbol names to document (e.g., ["MyClass", "myFunction"])'),
  workspaceUri: z
    .string()
    .optional()
    .describe('Workspace root URI for symbol resolution (optional, defaults to cwd)'),
  depth: z
    .number()
    .min(0)
    .max(10)
    .default(3)
    .describe('Recursion depth for gathering related symbols (default: 3, max: 10)'),
  includeReferences: z
    .boolean()
    .default(false)
    .describe('Whether to include usage examples from references (default: false)'),
  maxSymbols: z
    .number()
    .min(1)
    .max(200)
    .default(100)
    .optional()
    .describe('Maximum total symbols to gather (default: 100, prevents excessive gathering)'),
});

export type RelatedAPIsParams = z.infer<typeof relatedAPIsParamsSchema>;

// User-friendly symbol kinds
const SYMBOL_KIND_NAMES: Record<number, string> = {
  [SymbolKind.Function]: 'Function',
  [SymbolKind.Method]: 'Method',
  [SymbolKind.Class]: 'Class',
  [SymbolKind.Interface]: 'Interface',
  [SymbolKind.Enum]: 'Enum',
  [SymbolKind.Variable]: 'Variable',
  [SymbolKind.Constant]: 'Constant',
  [SymbolKind.Property]: 'Property',
  [SymbolKind.TypeParameter]: 'Type',
  [SymbolKind.Struct]: 'Struct',
};

interface DocumentedSymbol {
  name: string;
  type: string;
  location: {
    uri: string;
    line: number;
    column: number;
  };
  signature?: string;
  documentation?: string;
  members?: Array<{
    name: string;
    signature: string;
    documentation?: string;
  }>;
  depth: number;
}

export interface RelatedAPIsResultData {
  primarySymbols: DocumentedSymbol[];
  relatedSymbols?: DocumentedSymbol[];
  truncated?: boolean;
  totalFound: number;
  markdownReport: string;
}

export type RelatedAPIsResult = StandardResult<RelatedAPIsResultData>;

export class RelatedAPIsTool extends BatchableTool<RelatedAPIsParams, RelatedAPIsResult> {
  readonly name = 'getRelatedAPIs';
  readonly description = `Gather comprehensive API documentation for specified symbols with recursive dependency resolution.

Purpose: Extract function signatures, class definitions, type information, and related documentation.

Features:
- Symbol resolution by name using workspace/symbol
- Recursive dependency traversal with configurable depth
- Documentation extraction from hover responses
- Circular dependency prevention
- Markdown-formatted output

Use Cases:
- Understanding API surfaces before making changes
- Documenting related types and dependencies
- Exploring unfamiliar codebases`;

  get inputSchema(): z.ZodType<RelatedAPIsParams> {
    return relatedAPIsParamsSchema as unknown as z.ZodType<RelatedAPIsParams>;
  }

  /** Output schema for MCP tool discovery */
  readonly outputSchema = z.object({
    data: z.object({
      primarySymbols: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          location: z.object({
            uri: z.string(),
            line: z.number(),
            column: z.number(),
          }),
          signature: z.string().optional(),
          documentation: z.string().optional(),
          members: z
            .array(
              z.object({
                name: z.string(),
                signature: z.string(),
                documentation: z.string().optional(),
              })
            )
            .optional(),
          depth: z.number(),
        })
      ),
      relatedSymbols: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            location: z.object({
              uri: z.string(),
              line: z.number(),
              column: z.number(),
            }),
            signature: z.string().optional(),
            documentation: z.string().optional(),
            members: z
              .array(
                z.object({
                  name: z.string(),
                  signature: z.string(),
                  documentation: z.string().optional(),
                })
              )
              .optional(),
            depth: z.number(),
          })
        )
        .optional(),
      truncated: z.boolean().optional(),
      totalFound: z.number(),
      markdownReport: z.string(),
    }),
    metadata: z
      .object({
        processingTime: z.number().optional(),
      })
      .optional(),
    fallback: z.string().optional(),
    error: z.string().optional(),
  });

  /** MCP tool annotations */
  readonly annotations: ToolAnnotations = {
    title: 'Get Related APIs',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  private visitedSymbols = new Set<string>();

  constructor(manager: ConnectionPool, logger?: Logger) {
    super(manager);
    if (logger) {
      this.logger = logger;
    }
  }

  async execute(params: RelatedAPIsParams): Promise<RelatedAPIsResult> {
    const startTime = Date.now();
    this.visitedSymbols.clear();

    try {
      const workspace = params.workspaceUri || `file://${process.cwd()}`;
      const maxSymbols = params.maxSymbols || 100;

      this.logger.info(
        { symbols: params.symbols, depth: params.depth, workspace },
        'Gathering related APIs'
      );

      // Resolve primary symbols
      const primarySymbols: DocumentedSymbol[] = [];
      const notFound: string[] = [];

      for (const symbolName of params.symbols) {
        const documented = await this.resolveAndDocumentSymbol(symbolName, workspace, 0);
        if (documented) {
          primarySymbols.push(documented);
          this.visitedSymbols.add(this.getSymbolKey(documented));
        } else {
          notFound.push(symbolName);
        }
      }

      // If no primary symbols found, return error
      if (primarySymbols.length === 0) {
        throw new MCPError(MCPErrorCode.InternalError, `Symbols not found: ${notFound.join(', ')}`);
      }

      // Gather related symbols recursively
      const relatedSymbols: DocumentedSymbol[] = [];
      const queue = [...primarySymbols];

      while (queue.length > 0 && relatedSymbols.length + primarySymbols.length < maxSymbols) {
        const current = queue.shift();
        if (!current) break;

        // Skip if we've reached the depth limit
        if (current.depth >= params.depth) continue;

        // Extract referenced types from signature
        const referencedTypes = this.extractReferencedTypes(current.signature || '');

        // Resolve each referenced type
        for (const typeName of referencedTypes) {
          if (relatedSymbols.length + primarySymbols.length >= maxSymbols) break;

          const key = `${typeName}:${current.depth + 1}`;
          if (this.visitedSymbols.has(key)) continue;

          const documented = await this.resolveAndDocumentSymbol(
            typeName,
            workspace,
            current.depth + 1
          );

          if (documented) {
            relatedSymbols.push(documented);
            this.visitedSymbols.add(key);
            queue.push(documented);
          }
        }
      }

      // Generate markdown report
      const markdownReport = this.generateMarkdownReport(
        params.symbols,
        primarySymbols,
        relatedSymbols
      );

      const result: RelatedAPIsResult = {
        data: {
          primarySymbols,
          relatedSymbols: relatedSymbols.length > 0 ? relatedSymbols : undefined,
          truncated: relatedSymbols.length + primarySymbols.length >= maxSymbols,
          totalFound: primarySymbols.length + relatedSymbols.length,
          markdownReport,
        },
        metadata: {
          processingTime: Date.now() - startTime,
        },
      };

      return result;
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to gather related APIs');

      // Generate a minimal report even on error
      const errorReport = this.generateMarkdownReport(params.symbols, [], []);

      return {
        data: {
          primarySymbols: [],
          totalFound: 0,
          markdownReport: errorReport,
        },
        metadata: {
          processingTime: Date.now() - startTime,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveAndDocumentSymbol(
    symbolName: string,
    workspace: string,
    depth: number
  ): Promise<DocumentedSymbol | null> {
    try {
      // Detect workspace language
      const workspacePath = workspace.replace('file://', '');
      const language = await this.detectWorkspaceLanguage(workspacePath);
      const client = await this.clientManager.get(language, workspacePath);

      // Search for the symbol
      const wsParams: WorkspaceSymbolParams = {
        query: symbolName,
      };

      const symbolInfos = await retryWithBackoff(
        async () => {
          const result = await client.sendRequest<SymbolInformation[] | null>(
            'workspace/symbol',
            wsParams
          );

          if (!result || result.length === 0) {
            throw new Error('No symbols found - possible indexing lag');
          }

          return result;
        },
        {
          maxAttempts: 3,
          delayMs: 500,
          backoffMultiplier: 2,
          shouldRetry: (error: unknown) => {
            if (error instanceof Error) {
              return error.message.includes('No symbols found');
            }
            return false;
          },
          onRetry: (error: unknown, attempt: number) => {
            this.logger.info({ error, symbolName, attempt }, 'Retrying workspace symbol search');
          },
        }
      ).catch(() => null);

      if (!symbolInfos || symbolInfos.length === 0) {
        this.logger.warn({ symbolName }, 'Symbol not found in workspace');
        return null;
      }

      // Use the first matching symbol (TODO: handle ambiguous matches)
      const symbolInfo = symbolInfos[0];
      if (!symbolInfo) return null;

      // Get hover information for documentation
      const hover = await retryWithBackoff(
        async () => {
          const result = await client.sendRequest<Hover | null>('textDocument/hover', {
            textDocument: { uri: symbolInfo.location.uri },
            position: symbolInfo.location.range.start,
          });

          if (!result || !result.contents) {
            throw new Error('No hover information');
          }

          return result;
        },
        {
          maxAttempts: 3,
          delayMs: 500,
          backoffMultiplier: 2,
          shouldRetry: (error: unknown) => {
            if (error instanceof Error) {
              return error.message.includes('No hover');
            }
            return false;
          },
          onRetry: (error: unknown, attempt: number) => {
            this.logger.info({ error, symbolName, attempt }, 'Retrying hover request');
          },
        }
      ).catch(() => null);

      // Extract signature and documentation from hover
      const { signature, documentation } = this.extractFromHover(hover);

      const documented: DocumentedSymbol = {
        name: symbolInfo.name,
        type: SYMBOL_KIND_NAMES[symbolInfo.kind] || 'Unknown',
        location: {
          uri: symbolInfo.location.uri,
          line: symbolInfo.location.range.start.line,
          column: symbolInfo.location.range.start.character,
        },
        signature,
        documentation,
        depth,
      };

      return documented;
    } catch (error) {
      this.logger.warn({ error, symbolName }, 'Failed to resolve symbol');
      return null;
    }
  }

  private extractFromHover(hover: Hover | null): { signature?: string; documentation?: string } {
    if (!hover || !hover.contents) {
      return {};
    }

    let signature: string | undefined;
    let documentation: string | undefined;

    if (typeof hover.contents === 'string') {
      documentation = hover.contents;
    } else if ('kind' in hover.contents) {
      if (hover.contents.kind === MarkupKind.Markdown) {
        const text = hover.contents.value;

        // Parse markdown to extract structured content
        const tokens = marked.lexer(text);

        for (const token of tokens) {
          if (token.type === 'code' && !signature && 'text' in token && token.text) {
            signature = String(token.text).trim();
          } else if (
            (token.type === 'paragraph' || token.type === 'text') &&
            'raw' in token &&
            token.raw
          ) {
            documentation = (documentation || '') + String(token.raw) + '\n';
          }
        }

        if (documentation) {
          documentation = documentation.trim();
        }
      } else {
        documentation = hover.contents.value;
      }
    } else if (Array.isArray(hover.contents)) {
      for (const item of hover.contents) {
        if (typeof item === 'string') {
          documentation = (documentation || '') + '\n' + item;
        } else if ('language' in item) {
          signature = item.value;
        }
      }
    }

    return { signature, documentation };
  }

  private extractReferencedTypes(signature: string): string[] {
    if (!signature) return [];

    const types = new Set<string>();

    // Match type annotations like : TypeName or <TypeName>
    // This is a simplified type extraction - could be enhanced
    const typePatterns = [
      /:\s*([A-Z][a-zA-Z0-9_]*)/g, // : TypeName
      /<([A-Z][a-zA-Z0-9_]*)>/g, // <TypeName>
      /\(\s*([A-Z][a-zA-Z0-9_]*)\s*\)/g, // (TypeName)
      /Promise<([A-Z][a-zA-Z0-9_]*)>/g, // Promise<TypeName>
      /Array<([A-Z][a-zA-Z0-9_]*)>/g, // Array<TypeName>
    ];

    for (const pattern of typePatterns) {
      let match;
      while ((match = pattern.exec(signature)) !== null) {
        if (match[1]) {
          const typeName = match[1];
          // Filter out common built-in types
          if (!this.isBuiltInType(typeName) && typeName !== 'Promise' && typeName !== 'Array') {
            types.add(typeName);
          }
        }
      }
    }

    return Array.from(types);
  }

  private isBuiltInType(typeName: string): boolean {
    const builtIns = new Set([
      'String',
      'Number',
      'Boolean',
      'Object',
      'Array',
      'Function',
      'Date',
      'RegExp',
      'Error',
      'Map',
      'Set',
      'Promise',
      'Symbol',
      'BigInt',
      'Void',
      'Never',
      'Unknown',
      'Any',
    ]);

    return builtIns.has(typeName);
  }

  private getSymbolKey(symbol: DocumentedSymbol): string {
    return `${symbol.name}:${symbol.depth}`;
  }

  private generateMarkdownReport(
    requestedSymbols: string[],
    primarySymbols: DocumentedSymbol[],
    relatedSymbols: DocumentedSymbol[]
  ): string {
    const lines: string[] = [];

    lines.push(`# Related APIs for: ${requestedSymbols.join(', ')}`);
    lines.push('');

    if (primarySymbols.length > 0) {
      lines.push('## Primary Symbols');
      lines.push('');

      for (const symbol of primarySymbols) {
        lines.push(...this.formatSymbol(symbol));
      }
    }

    if (relatedSymbols.length > 0) {
      // Group related symbols by depth
      const byDepth = new Map<number, DocumentedSymbol[]>();
      for (const symbol of relatedSymbols) {
        const depth = symbol.depth;
        if (!byDepth.has(depth)) {
          byDepth.set(depth, []);
        }
        byDepth.get(depth)?.push(symbol);
      }

      for (const [depth, symbols] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
        lines.push(`## Related Symbols (Depth ${depth})`);
        lines.push('');

        for (const symbol of symbols) {
          lines.push(...this.formatSymbol(symbol));
        }
      }
    }

    return lines.join('\n');
  }

  private formatSymbol(symbol: DocumentedSymbol): string[] {
    const lines: string[] = [];

    lines.push(`### ${symbol.name}`);
    lines.push(`**Type**: ${symbol.type}`);
    lines.push(`**Location**: ${this.formatLocation(symbol.location)}`);
    lines.push('');

    if (symbol.signature) {
      const language = this.guessLanguageFromSignature(symbol.signature);
      lines.push(`\`\`\`${language}`);
      lines.push(symbol.signature);
      lines.push('```');
      lines.push('');
    }

    if (symbol.documentation) {
      lines.push('**Documentation**:');
      lines.push(`> ${symbol.documentation.split('\n').join('\n> ')}`);
      lines.push('');
    }

    if (symbol.members && symbol.members.length > 0) {
      lines.push('**Members**:');
      for (const member of symbol.members) {
        lines.push(`- \`${member.signature}\``);
        if (member.documentation) {
          lines.push(`  - ${member.documentation}`);
        }
      }
      lines.push('');
    }

    return lines;
  }

  private formatLocation(location: { uri: string; line: number; column: number }): string {
    const uri = location.uri.replace('file://', '');
    return `${uri}:${location.line + 1}:${location.column + 1}`;
  }

  private guessLanguageFromSignature(signature: string): string {
    if (signature.includes('function') || signature.includes('=>')) {
      return 'typescript';
    }
    if (signature.includes('def ')) {
      return 'python';
    }
    if (signature.includes('fn ')) {
      return 'rust';
    }
    if (signature.includes('func ')) {
      return 'go';
    }
    return 'typescript'; // Default
  }

  private async detectWorkspaceLanguage(workspace: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');

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

      // Default to TypeScript
      return 'typescript';
    } catch (error) {
      this.logger.warn({ error }, 'Failed to detect workspace language, defaulting to TypeScript');
      return 'typescript';
    }
  }
}
