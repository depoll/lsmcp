import { z } from 'zod';
import { BaseTool } from './base.js';
import {
  SymbolInformation,
  WorkspaceSymbol,
  Location,
  Hover,
  DocumentSymbol,
  SymbolKind,
  MarkupContent,
  Range,
  SemanticTokens,
  SemanticTokensLegend,
  LocationLink
} from 'vscode-languageserver-protocol';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const InputSchema = z.object({
  symbols: z.array(z.string()).min(1).describe('List of symbol names to document'),
  depth: z.number().min(0).max(10).default(4).describe('Recursion depth for gathering related symbols (members)'),
  includeReferences: z.boolean().default(false).describe('Whether to include usage examples from references (not implemented yet)'),
  maxSymbols: z.number().min(1).max(200).default(100).describe('Maximum total symbols to gather (prevent explosion)'),
  workspaceUri: z.string().optional().describe('Workspace root URI (optional)')
});

type Input = z.infer<typeof InputSchema>;

interface SymbolDoc {
  name: string;
  kind: SymbolKind;
  detail?: string;
  documentation?: string;
  children?: SymbolDoc[];
  location: Location;
}

/**
 * Tool for retrieving API documentation and related symbols.
 * Uses LSP to traverse symbol relationships.
 */
export class GetRelatedAPIsTool extends BaseTool<Input, string> {
  readonly name = 'getRelatedAPIs';
  readonly description = 'Gather comprehensive API documentation for specified symbols with recursive dependency resolution. extracts signatures, docs, and members.';
  readonly inputSchema = InputSchema as unknown as z.ZodSchema<Input>;

  private visited = new Set<string>();
  private collectedSymbols: SymbolDoc[] = [];
  
  // Cache for semantic tokens per file
  private tokenCache = new Map<string, { tokens: SemanticTokens, content: string }>();
  private legendCache = new Map<string, SemanticTokensLegend>();

  async execute(params: Input): Promise<string> {
    const { symbols, depth, maxSymbols } = params;
    this.visited.clear();
    this.collectedSymbols = [];
    this.tokenCache.clear();
    this.legendCache.clear();

    for (const symbolName of symbols) {
        await this.findAndCollectSymbol(symbolName, depth, maxSymbols);
    }

    return this.formatOutput();
  }

  private async findAndCollectSymbol(name: string, depth: number, _maxLimit: number) {
      const clients = this.clientManager.getAllActive(); 
      if (clients.length === 0) return;
      
      for (const { language, connection: client } of clients) {
          try {
              const results = await client.sendRequest<SymbolInformation[] | WorkspaceSymbol[]>('workspace/symbol', { query: name });
              const symbols = results || [];
              
              const match = symbols.sort((a, b) => {
                  const aName = a.name;
                  const bName = b.name;
                  if (aName === name && bName !== name) return -1;
                  if (bName === name && aName !== name) return 1;
                  return aName.length - bName.length;
              })[0];

              if (match) {
                  let location: Location | undefined;
                  
                  if ('location' in match) {
                      location = match.location as Location;
                  } else if ('uri' in match) {
                       location = {
                           uri: (match as any).uri, 
                           range: (match as any).range || { start: { line:0, character:0}, end: {line:0, character:0}}
                       };
                  }
                  
                  if (!location || !location.uri) continue;

                  let rootNode: DocumentSymbol | undefined;
                  try {
                      const docSymbols = await client.sendRequest('textDocument/documentSymbol', {
                         textDocument: { uri: location.uri }
                     }) as (DocumentSymbol | SymbolInformation)[];
                     
                     if (docSymbols && docSymbols.length > 0 && DocumentSymbol.is(docSymbols[0])) {
                         rootNode = this.findSymbolInRange(docSymbols as DocumentSymbol[], location.range);
                     }
                  } catch (e) {
                      // Ignore
                  }

                  if (rootNode) {
                      await this.processSymbolRecursively(client, rootNode, location.uri, depth);
                  } else {
                      await this.processSymbolRecursively(client, {
                          name: match.name, // Use match name
                          kind: match.kind,
                          range: location.range,
                          selectionRange: location.range,
                          children: []
                      } as DocumentSymbol, location.uri, depth);
                  }
                  return; 
              }
          } catch (e) {
              this.logger.warn({ error: e, client: language }, 'Error searching symbol');
          }
      }
  }

  private async processSymbolRecursively(
      client: any, 
      node: DocumentSymbol, 
      uri: string, 
      depth: number
  ) {
      const range = node.selectionRange;
      const key = `${uri}:${range.start.line}:${range.start.character}`;
      
      if (this.visited.has(key)) return;
      if (this.collectedSymbols.length >= 100) return;
      this.visited.add(key);

      // 1. Get Hover (Docs)
      let docString = '';
      let refinedName = node.name;

      try {
          const hover = await client.sendRequest('textDocument/hover', {
              textDocument: { uri: uri },
              position: range.start 
          }) as Hover | null;
          
          if (hover && hover.contents) {
              if (MarkupContent.is(hover.contents)) {
                  docString = hover.contents.value;
              } else if (Array.isArray(hover.contents)) {
                  docString = hover.contents.map(c => typeof c === 'string' ? c : c.value).join('\n\n');
              } else {
                   docString = (hover.contents as any).value || String(hover.contents);
              }
              
              // Try to extract a better name from the code block if we have a placeholder
              if (refinedName === 'Unknown (Definition)' && docString) {
                  const codeBlockMatch = docString.match(/```(?:typescript|ts|javascript|js)?\s*(?:interface|class|type|const|var|let|function)?\s+([a-zA-Z0-9_]+)/);
                  if (codeBlockMatch && codeBlockMatch[1]) {
                      refinedName = codeBlockMatch[1];
                  }
              }
          }
      } catch (e) {
          // ignore
      }

      const symbolDoc: SymbolDoc = {
          name: refinedName,
          kind: node.kind,
          location: { uri, range: node.range }, 
          documentation: docString,
          children: []
      };
      
      this.collectedSymbols.push(symbolDoc);

      if (depth > 0) {
          // 1. Recurse into children (members)
          if (this.shouldRecurseIntoChildren(node.kind)) {
              if (node.children) {
                 for (const child of node.children) {
                     await this.processSymbolRecursively(client, child, uri, depth - 1);
                     symbolDoc.children?.push({
                         name: child.name,
                         kind: child.kind,
                         location: { uri, range: child.range },
                         documentation: '...', 
                     });
                 }
              }
          }

          // 2. Find referenced types via Semantic Tokens + Definition
          await this.resolveReferencedTypes(client, uri, node.range, depth - 1);
      }
  }
  
  private async resolveReferencedTypes(client: any, uri: string, range: Range, depth: number) {
      try {
          // 1. Get Legend
          const serverId = client.getId ? client.getId() : 'unknown';
          let legend = this.legendCache.get(serverId);
          if (!legend) {
              const caps = client.getCapabilities();
              legend = caps?.semanticTokensProvider?.legend;
              if (legend) this.legendCache.set(serverId, legend);
          }
          if (!legend) return;

          // 2. Get Tokens & Content
          let cached = this.tokenCache.get(uri);
          if (!cached) {
              const tokens = await client.sendRequest('textDocument/semanticTokens/full', {
                  textDocument: { uri }
              }) as SemanticTokens;
              
              let content = '';
              if (uri.startsWith('file://')) {
                  content = await readFile(fileURLToPath(uri), 'utf-8');
              }
              
              cached = { tokens, content };
              this.tokenCache.set(uri, cached);
          }
          if (!cached.tokens || !cached.tokens.data) return;

          // 3. Scan tokens in range
          const data = cached.tokens.data;
          let line = 0;
          let char = 0;
          
          const referencedDefinitions = new Set<string>(); // Dedup by definition location
          
          for (let i = 0; i < data.length; i += 5) {
              const deltaLine = data[i];
              const deltaStart = data[i+1];
              // const length = data[i+2]; // Unused
              const tokenTypeIndex = data[i+3];
              
              if (deltaLine === undefined || deltaStart === undefined || tokenTypeIndex === undefined) continue;

              if (deltaLine > 0) {
                  line += deltaLine;
                  char = deltaStart;
              } else {
                  char += deltaStart;
              }
              
              // Check if token is within the symbol's range
              if (line < range.start.line || (line === range.start.line && char < range.start.character)) continue;
              if (line > range.end.line || (line === range.end.line && char > range.end.character)) break;

              // Check if token type is interesting (Class, Interface, Enum, Type, Struct, TypeParameter)
              const tokenType = legend.tokenTypes[tokenTypeIndex];
              if (!tokenType || !this.isInterestingType(tokenType)) continue;

              // Get definition
              try {
                  const definitions = await client.sendRequest('textDocument/definition', {
                      textDocument: { uri },
                      position: { line, character: char }
                  }) as Location | Location[] | LocationLink[] | null;

                  if (!definitions) continue;

                  const defs = Array.isArray(definitions) ? definitions : [definitions];
                  for (const def of defs) {
                       let defUri: string;
                       let defRange: Range;

                       if ('targetUri' in def) {
                           defUri = def.targetUri;
                           defRange = def.targetSelectionRange;
                       } else {
                           defUri = (def as Location).uri;
                           defRange = (def as Location).range;
                       }
                       
                       // Avoid self
                       if (defUri === uri && this.rangesIntersect(defRange, range)) continue;

                       // Filter out standard library definitions to avoid noise
                       if (defUri.includes('node_modules/typescript/lib') || defUri.endsWith('lib.d.ts')) continue;
                       
                       const defKey = `${defUri}:${defRange.start.line}:${defRange.start.character}`;
                       if (referencedDefinitions.has(defKey)) continue;
                       referencedDefinitions.add(defKey);

                       // Extract the text of the token to use as the name
                       const lines = cached.content.split(/\r?\n/);
                       let tokenText = 'Unknown';
                       const lineContent = lines[line];
                       if (lineContent !== undefined) {
                           const tokenLen = data[i+2];
                           tokenText = lineContent.substr(char, tokenLen);
                       }

                       await this.processDefinition(client, defUri, defRange, depth, tokenText);
                  }
              } catch (e) {
                  // ignore definition errors
              }
          }
      } catch (e) {
          this.logger.warn({ error: e }, 'Error resolving referenced types');
      }
  }
  
  private async processDefinition(client: any, uri: string, range: Range, depth: number, knownName: string) {
      // We have a location. We need the DocumentSymbol to recurse properly.
      try {
          const docSymbols = await client.sendRequest('textDocument/documentSymbol', {
              textDocument: { uri }
          }) as (DocumentSymbol | SymbolInformation)[];
          
          if (docSymbols && docSymbols.length > 0 && DocumentSymbol.is(docSymbols[0])) {
              const rootNode = this.findSymbolInRange(docSymbols as DocumentSymbol[], range);
              if (rootNode) {
                  await this.processSymbolRecursively(client, rootNode, uri, depth);
                  return;
              }
          } 
          
          // Fallback: If no hierarchical symbols (e.g. standard lib or dependencies), use known name
          await this.processSymbolRecursively(client, {
              name: knownName,
              kind: SymbolKind.Variable, // Placeholder
              range: range,
              selectionRange: range,
              children: []
          } as DocumentSymbol, uri, depth); 
      } catch (e) {
          // ignore
      }
  }

  private isInterestingType(tokenType: string): boolean {
      return [
          'class', 'interface', 'enum', 'type', 'struct', 'typeParameter', 'namespace'
      ].includes(tokenType);
  }

  private shouldRecurseIntoChildren(kind: SymbolKind): boolean {
      switch (kind) {
          case SymbolKind.Class:
          case SymbolKind.Interface:
          case SymbolKind.Module:
          case SymbolKind.Namespace:
          case SymbolKind.Enum:
          case SymbolKind.Struct:
          case SymbolKind.Package:
              return true;
          default:
              // Do NOT recurse into Method, Function, Constructor, Property, Field, etc.
              return false;
      }
  }

  private findSymbolInRange(symbols: DocumentSymbol[], range: Range): DocumentSymbol | undefined {
      for (const sym of symbols) {
           if (this.rangesIntersect(sym.range, range)) {
             if (this.isSameRange(sym.range, range) || this.isSameRange(sym.selectionRange, range)) {
                 return sym;
             }
             if (sym.children) {
                 const found = this.findSymbolInRange(sym.children, range);
                 if (found) return found;
             }
          }
      }
      return undefined;
  }
  
  private isSameRange(r1: Range, r2: Range) {
      return r1.start.line === r2.start.line && r1.start.character === r2.start.character;
  }
  
  private rangesIntersect(r1: Range, r2: Range) {
      if (r2.start.line < r1.start.line || r2.start.line > r1.end.line) return false;
      if (r1.start.line < r2.start.line || r1.start.line > r2.end.line) return false;
      return true;
  }

  private formatOutput(): string {
      if (this.collectedSymbols.length === 0) return "No symbols found.";
      
      let md = "# API Documentation\n\n";
      
      for (const sym of this.collectedSymbols) {
          md += `## ${sym.name} (${this.getKindName(sym.kind)})
`;
          md += `**Location**: lexible${sym.location.uri}flexible

`;

          if (sym.documentation) {
              md += `**Documentation**:\n${sym.documentation}\n\n`;
          }
          
          if (sym.children && sym.children.length > 0) {
              md += `**Members**:\n`;
              for (const child of sym.children) {
                  md += `- ${child.name} (${this.getKindName(child.kind)})
`;
              }
              md += `\n`;
          }
          
          md += `---\n`;
      }
      
      return md;
  }

  private getKindName(kind: SymbolKind): string {
      const kinds = [
        'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property',
        'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable',
        'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key',
        'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter'
      ];
      return kinds[kind - 1] || 'Unknown';
  }
}