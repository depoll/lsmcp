import { z } from 'zod';
import { BatchableTool } from './base.js';
import { ConnectionPool } from '../lsp/index.js';
import {
  Position,
  Hover,
  SignatureHelp,
  Location,
  DocumentSymbol,
  SymbolKind,
  MarkupKind,
  Range as LSPRange,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  CallHierarchyPrepareParams,
  CallHierarchyIncomingCallsParams,
  CallHierarchyOutgoingCallsParams,
} from 'vscode-languageserver-protocol';
import { marked } from 'marked';
import { createPositionSchema, SYMBOL_POSITION_DESCRIPTION } from './position-schema.js';
import { FILE_URI_DESCRIPTION } from './file-uri-description.js';
import { StandardResult, ToolAnnotations } from './common-types.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { LSPClient } from '../lsp/client-v2.js';
import { promises as fs } from 'fs';
import { fileURLToPath, URL } from 'url';

const logger = rootLogger.child({ module: 'symbol-context-tool' });

// From symbolSearch.ts
const USER_SYMBOL_KINDS = [
  'function', 'class', 'interface', 'variable', 'constant', 'method', 'property', 'enum',
] as const;
type UserSymbolKind = (typeof USER_SYMBOL_KINDS)[number];
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
const REVERSE_KIND_MAP: Map<SymbolKind, UserSymbolKind> = new Map();
for (const [userKind, lspKinds] of Object.entries(KIND_MAP)) {
  for (const lspKind of lspKinds) {
    REVERSE_KIND_MAP.set(lspKind, userKind as UserSymbolKind);
  }
}
const lspKindToString = (kind: SymbolKind): string => {
    return REVERSE_KIND_MAP.get(kind) || 'unknown';
}

const SymbolContextParamsSchema = z.object({
  uri: z.string().describe(FILE_URI_DESCRIPTION),
  position: createPositionSchema().describe(SYMBOL_POSITION_DESCRIPTION),
  maxReferences: z.number().min(1).max(50).default(10).optional().describe('Max number of references to return.'),
  includeCallHierarchy: z.boolean().optional().describe('Whether to include call hierarchy information.'),
  maxHierarchyDepth: z.number().min(1).max(10).default(3).optional().describe('Maximum depth for call hierarchy traversal.'),
});

type SymbolContextParams = z.infer<typeof SymbolContextParamsSchema>;

const RangeSchema = z.object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
});

const LocationSchema = z.object({
    uri: z.string(),
    range: RangeSchema,
});

const SymbolInfoSchema = z.object({
  name: z.string(),
  kind: z.string(),
  type: z.string().optional(),
  documentation: z.string().optional(),
});
type SymbolInfo = z.infer<typeof SymbolInfoSchema>;


const SignatureInfoSchema = z.object({
  label: z.string(),
  parameters: z.array(z.object({ label: z.string(), doc: z.string().optional() })),
});
type SignatureInfo = z.infer<typeof SignatureInfoSchema>;

const UsageInfoSchema = z.object({
  uri: z.string(),
  range: RangeSchema,
  preview: z.string().optional(),
});
type UsageInfo = z.infer<typeof UsageInfoSchema>;


const SurroundingSymbolInfoSchema = z.object({
    name: z.string(),
    kind: z.string(),
    location: LocationSchema,
    code: z.string().optional(),
});

export interface CallHierarchyResult {
  name: string;
  kind: SymbolKind;
  uri: string;
  range: LSPRange;
  selectionRange: LSPRange;
  detail?: string;
  calls?: CallHierarchyResult[];
}

const CallHierarchyResultSchema: z.ZodType<CallHierarchyResult> = z.lazy(() => z.object({
    name: z.string(),
    kind: z.nativeEnum(SymbolKind),
    uri: z.string(),
    range: RangeSchema,
    selectionRange: RangeSchema,
    detail: z.string().optional(),
    calls: z.array(CallHierarchyResultSchema).optional(),
}));

const CallHierarchyInfoSchema = z.object({
    incoming: z.array(CallHierarchyResultSchema),
    outgoing: z.array(CallHierarchyResultSchema),
});

const SymbolContextResultDataSchema = z.object({
  symbol: SymbolInfoSchema.optional(),
  signature: SignatureInfoSchema.optional(),
  references: z.array(UsageInfoSchema).optional(),
  surroundings: z.object({
      containerName: z.string(),
      symbols: z.array(SurroundingSymbolInfoSchema),
  }).optional(),
  callHierarchy: CallHierarchyInfoSchema.optional(),
});

type SymbolContextResultData = z.infer<typeof SymbolContextResultDataSchema>;
type SymbolContextResult = StandardResult<SymbolContextResultData>;


export class SymbolContextTool extends BatchableTool<
  SymbolContextParams,
  SymbolContextResult
> {
  readonly name = 'getSymbolContext';
  readonly description = 'Get contextual information for a symbol at a given position.';
  readonly inputSchema = SymbolContextParamsSchema;
  readonly outputSchema = z.object({
      data: SymbolContextResultDataSchema,
      metadata: z.object({
          processingTime: z.number().optional(),
      }).optional(),
      error: z.string().optional(),
  });
  readonly annotations: ToolAnnotations = {
    title: 'Get Symbol Context',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  constructor(clientManager: ConnectionPool) {
    super(clientManager);
  }

  async execute(params: SymbolContextParams): Promise<SymbolContextResult> {
    const startTime = Date.now();
    const { uri, position, maxReferences, includeCallHierarchy, maxHierarchyDepth } = params;
    const lspPosition: Position = {
      line: position.line,
      character: position.character,
    };

    logger.info({ uri, position }, 'Executing getSymbolContext request');

    try {
      const workspace = this.extractWorkspaceFromUri(uri);
      const client = await this.clientManager.getForFile(uri, workspace);
      if (!client) {
        throw new Error(`No language client available for URI: ${uri}`);
      }

      const promises: Promise<any>[] = [
        this.getHoverInfo(client, uri, lspPosition),
        this.getSignatureHelpInfo(client, uri, lspPosition),
        this.getReferences(client, uri, lspPosition, maxReferences),
        this.getDocumentSymbols(client, uri),
      ];

      if (includeCallHierarchy) {
        promises.push(this.getCallHierarchyInfo(client, uri, lspPosition, maxHierarchyDepth || 3));
      }

      const results = await Promise.allSettled(promises);
      const [hoverResult, signatureHelpResult, referencesResult, documentSymbolsResult, callHierarchyResult] = results;

      const hover = hoverResult?.status === 'fulfilled' ? hoverResult.value : undefined;
      const signatureHelp = signatureHelpResult?.status === 'fulfilled' ? signatureHelpResult.value : undefined;
      const references = referencesResult?.status === 'fulfilled' ? referencesResult.value : [];
      const documentSymbols = documentSymbolsResult?.status === 'fulfilled' ? documentSymbolsResult.value : [];
      const callHierarchy = callHierarchyResult?.status === 'fulfilled' ? callHierarchyResult.value : undefined;

      const surroundings = this.getSurroundings(documentSymbols, lspPosition);

      const symbolName = hover?.name || surroundings?.symbol?.name;

      const surroundingSymbolsWithCode = surroundings ? await Promise.all(
          surroundings.siblings.map(async s => ({
              name: s.name,
              kind: lspKindToString(s.kind),
              location: { uri, range: s.range },
              code: await this.getCodeSnippet({ uri, range: s.range }),
          }))
      ) : undefined;

      const resultData: SymbolContextResultData = {
        symbol: hover ? { ...hover, name: symbolName || 'unknown' } : undefined,
        signature: signatureHelp,
        references,
        surroundings: surroundings && surroundingSymbolsWithCode ? {
            containerName: surroundings.container?.name || 'file-level',
            symbols: surroundingSymbolsWithCode,
        } : undefined,
        callHierarchy,
      };

      return {
        data: resultData,
        metadata: {
          processingTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger.error({ error, uri, position }, 'getSymbolContext request failed');
      return {
        data: {},
        metadata: {
          processingTime: Date.now() - startTime,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getHoverInfo(client: LSPClient, uri: string, position: Position): Promise<SymbolInfo | undefined> {
    const hover = await client.sendRequest<Hover | null>('textDocument/hover', {
        textDocument: { uri },
        position,
    });

    if (!hover || !hover.contents) {
        return undefined;
    }

    const content: { type?: string, documentation?: string } = {};
    if (typeof hover.contents === 'string') {
      content.documentation = hover.contents;
    } else if ('kind'in hover.contents) {
      if (hover.contents.kind === MarkupKind.Markdown) {
        const text = hover.contents.value;
        const tokens = marked.lexer(text);
        for (const token of tokens) {
          if (token.type === 'code' && !content.type && 'text' in token && token.text) {
            content.type = String(token.text).trim();
          } else if ((token.type === 'paragraph' || token.type === 'text') && 'raw' in token && token.raw) {
            content.documentation = (content.documentation || '') + String(token.raw);
          }
        }
        if (content.documentation) {
          content.documentation = content.documentation.trim();
        }
      } else {
        content.documentation = hover.contents.value;
      }
    } else if (Array.isArray(hover.contents)) {
      for (const item of hover.contents) {
        if (typeof item === 'string') {
          content.documentation = (content.documentation || '') + '\n' + item;
        } else if ('language' in item) {
          content.type = item.value;
        }
      }
    }

    let name = "unknown";
    let kind = "unknown";
    if(content.type) {
        // Example: 'function MyClass.myMethod(arg: string): number'
        const kindMatch = content.type.match(/^(function|class|interface|variable|const|method|property|enum)/);
        if (kindMatch && kindMatch[1]) {
            kind = kindMatch[1];
            const rest = content.type.substring(kind.length).trim();
            const nameMatch = rest.match(/^([^\s(]+)/);
            if (nameMatch && nameMatch[1]) {
                name = nameMatch[1];
            }
        } else {
            // Fallback for things like '(method) MyClass.myMethod(...)'
            const parts = content.type.match(/^\(([^)]+)\)\s*([^\s(]+)/);
            if(parts && parts[1] && parts[2]) {
                kind = parts[1];
                name = parts[2];
            }
        }
    }

    return {
        name,
        kind,
        type: content.type,
        documentation: content.documentation,
    };
  }

  private async getSignatureHelpInfo(client: LSPClient, uri: string, position: Position): Promise<SignatureInfo | undefined> {
    const signatureHelp = await client.sendRequest<SignatureHelp | null>('textDocument/signatureHelp', {
        textDocument: { uri },
        position,
    });

    if (!signatureHelp || !signatureHelp.signatures || signatureHelp.signatures.length === 0) {
        return undefined;
    }

    const sig = signatureHelp.signatures[0];
    if (!sig) return undefined;

    return {
        label: sig.label,
        parameters: sig.parameters?.map(p => {
            let doc: string | undefined;
            if (p.documentation) {
                if (typeof p.documentation === 'string') {
                    doc = p.documentation;
                } else if ('value' in p.documentation) {
                    doc = p.documentation.value;
                }
            }
            const label = typeof p.label === 'string' ? p.label : sig.label.substring(p.label[0], p.label[1]);
            return { label, doc };
        }) || [],
    };
  }

  private async getReferences(client: LSPClient, uri: string, position: Position, maxReferences: number = 10): Promise<UsageInfo[]> {
    const locations = await client.sendRequest<Location[] | null>('textDocument/references', {
        textDocument: { uri },
        position,
        context: { includeDeclaration: false }
    });

    if (!locations) {
        return [];
    }

    const references: UsageInfo[] = [];
    for (const location of locations.slice(0, maxReferences)) {
        const preview = await this.generatePreview(location);
        references.push({
            uri: location.uri,
            range: location.range,
            preview,
        });
    }
    return references;
  }

  private async generatePreview(location: Location): Promise<string | undefined> {
    try {
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

  private async getDocumentSymbols(client: LSPClient, uri: string): Promise<DocumentSymbol[]> {
      const symbols = await client.sendRequest<DocumentSymbol[] | null>('textDocument/documentSymbol', {
          textDocument: { uri }
      });
      return symbols || [];
  }

  private getSurroundings(symbols: DocumentSymbol[], position: Position): { symbol: DocumentSymbol, container?: DocumentSymbol, siblings: DocumentSymbol[] } | undefined {
    const found = this.findSymbolInTree(symbols, position);
    if (!found) return undefined;

    const { symbol, container } = found;

    const siblings = ((container?.children) || symbols).filter(s => s !== symbol);

    return { symbol, container, siblings };
  }

  private findSymbolInTree(symbols: DocumentSymbol[], position: Position, container?: DocumentSymbol): { symbol: DocumentSymbol, container?: DocumentSymbol } | undefined {
      for (const symbol of symbols) {
          if (this.isPositionInRange(position, symbol.range)) {
              const foundInChildren = this.findSymbolInTree(symbol.children || [], position, symbol);
              if (foundInChildren) {
                  return foundInChildren;
              }
              return { symbol, container };
          }
      }
      return undefined;
  }

  private isPositionInRange(position: Position, range: LSPRange): boolean {
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

  private async getCodeSnippet(location: Location): Promise<string> {
    try {
      const filePath = fileURLToPath(location.uri);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const { start, end } = location.range;

      if (start.line === end.line) {
        return lines[start.line]?.substring(start.character, end.character) || '';
      }

      const snippetLines = [];
      // First line
      snippetLines.push(lines[start.line]?.substring(start.character) || '');
      // Middle lines
      for (let i = start.line + 1; i < end.line; i++) {
        snippetLines.push(lines[i] || '');
      }
      // Last line
      snippetLines.push(lines[end.line]?.substring(0, end.character) || '');

      return snippetLines.join('\n');
    } catch (error) {
      logger.warn({ error, location }, 'Failed to get code snippet');
      return '';
    }
  }

  private async getCallHierarchyInfo(client: LSPClient, uri: string, position: Position, maxDepth: number): Promise<{ incoming: CallHierarchyResult[], outgoing: CallHierarchyResult[] } | undefined> {
    const prepareParams: CallHierarchyPrepareParams = {
      textDocument: { uri },
      position,
    };

    const items = await client.sendRequest<CallHierarchyItem[] | null>('textDocument/prepareCallHierarchy', prepareParams);

    if (!items || items.length === 0) {
      return undefined;
    }

    const item = items[0];
    if (!item) {
        return undefined;
    }

    const [incoming, outgoing] = await Promise.all([
        this.getIncomingCalls(client, item, maxDepth),
        this.getOutgoingCalls(client, item, maxDepth),
    ]);

    return { incoming, outgoing };
  }

  private async getIncomingCalls(client: LSPClient, item: CallHierarchyItem, maxDepth: number, currentDepth = 0, visited = new Set<string>()): Promise<CallHierarchyResult[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
    if (visited.has(key)) {
      return []; // Avoid cycles
    }
    visited.add(key);

    const params: CallHierarchyIncomingCallsParams = { item };
    const incomingCalls = await client.sendRequest<CallHierarchyIncomingCall[] | null>('callHierarchy/incomingCalls', params);

    const results: CallHierarchyResult[] = [];
    for (const call of incomingCalls || []) {
        const result: CallHierarchyResult = {
          name: call.from.name,
          kind: call.from.kind,
          uri: call.from.uri,
          range: call.from.range,
          selectionRange: call.from.selectionRange,
          detail: call.from.detail,
          calls: await this.getIncomingCalls(client, call.from, maxDepth, currentDepth + 1, visited),
        };
        results.push(result);
    }
    return results;
  }

  private async getOutgoingCalls(client: LSPClient, item: CallHierarchyItem, maxDepth: number, currentDepth = 0, visited = new Set<string>()): Promise<CallHierarchyResult[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }
    const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
    if (visited.has(key)) {
      return []; // Avoid cycles
    }
    visited.add(key);

    const params: CallHierarchyOutgoingCallsParams = { item };
    const outgoingCalls = await client.sendRequest<CallHierarchyOutgoingCall[] | null>('callHierarchy/outgoingCalls', params);

    const results: CallHierarchyResult[] = [];
    for (const call of outgoingCalls || []) {
        const result: CallHierarchyResult = {
          name: call.to.name,
          kind: call.to.kind,
          uri: call.to.uri,
          range: call.to.range,
          selectionRange: call.to.selectionRange,
          detail: call.to.detail,
          calls: await this.getOutgoingCalls(client, call.to, maxDepth, currentDepth + 1, visited),
        };
        results.push(result);
    }
    return results;
  }
}
