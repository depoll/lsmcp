import {
  CompletionItem,
  CompletionTriggerKind,
  Hover,
  Position,
  SignatureHelp,
  MarkupKind,
  CompletionItemKind,
} from 'vscode-languageserver-protocol';
import { z } from 'zod';
import { marked } from 'marked';
import { ConnectionPool } from '../lsp/index.js';
import { logger } from '../utils/logger.js';
import { FileAwareLRUCache } from '../utils/fileCache.js';
import { getLanguageFromUri } from '../utils/languages.js';

// Configuration constants
const CACHE_SIZE = 100;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_RESULTS = 50;

const CodeIntelligenceParamsSchema = z.object({
  uri: z.string(),
  position: z.object({
    line: z.number(),
    character: z.number(),
  }),
  type: z.enum(['hover', 'signature', 'completion']),
  completionContext: z
    .object({
      triggerCharacter: z.string().optional(),
      triggerKind: z.number().optional(),
    })
    .optional(),
  maxResults: z.number().optional(),
});

type CodeIntelligenceParams = z.infer<typeof CodeIntelligenceParamsSchema>;

interface HoverResult {
  type: 'hover';
  content: {
    type?: string;
    documentation?: string;
    examples?: string;
  };
}

interface SignatureResult {
  type: 'signature';
  signatures: Array<{
    label: string;
    parameters: Array<{
      label: string;
      doc?: string;
    }>;
    activeParameter?: number;
  }>;
}

interface CompletionResult {
  type: 'completion';
  items: Array<{
    label: string;
    kind: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
  }>;
}

type CodeIntelligenceResult = HoverResult | SignatureResult | CompletionResult;

export class CodeIntelligenceTool {
  name = 'getCodeIntelligence';
  description = 'Get hover info, signatures, or completions at a position';

  inputSchema = {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        format: 'uri',
        description: 'File URI (e.g., file:///path/to/file.ts)',
      },
      position: {
        type: 'object',
        properties: {
          line: {
            type: 'number',
            description: 'Zero-based line number',
          },
          character: {
            type: 'number',
            description: 'Zero-based character offset',
          },
        },
        required: ['line', 'character'],
      },
      type: {
        type: 'string',
        enum: ['hover', 'signature', 'completion'],
        description: 'Type of intelligence to retrieve',
      },
      completionContext: {
        type: 'object',
        properties: {
          triggerCharacter: {
            type: 'string',
            description: 'Character that triggered completion (e.g., ".")',
          },
          triggerKind: {
            type: 'number',
            description:
              'How completion was triggered (1=Invoked, 2=TriggerCharacter, 3=Incomplete)',
          },
        },
      },
      maxResults: {
        type: 'number',
        default: DEFAULT_MAX_RESULTS,
        description: 'Maximum number of completion items to return',
      },
    },
    required: ['uri', 'position', 'type'],
  };

  private hoverCache: FileAwareLRUCache<Hover>;
  private signatureCache: FileAwareLRUCache<SignatureHelp>;

  constructor(private clientManager: ConnectionPool) {
    // Initialize caches with configured size and TTL
    this.hoverCache = new FileAwareLRUCache<Hover>(CACHE_SIZE, CACHE_TTL);
    this.signatureCache = new FileAwareLRUCache<SignatureHelp>(CACHE_SIZE, CACHE_TTL);
  }

  async execute(params: unknown): Promise<CodeIntelligenceResult> {
    const typedParams = CodeIntelligenceParamsSchema.parse(params);
    const { uri, position, type } = typedParams;
    const lspPosition: Position = {
      line: position.line,
      character: position.character,
    };

    logger.info({ uri, position, type }, 'Executing code intelligence request');

    try {
      switch (type) {
        case 'hover':
          return await this.getHover(uri, lspPosition);
        case 'signature':
          return await this.getSignatureHelp(uri, lspPosition);
        case 'completion':
          return await this.getCompletions(uri, lspPosition, typedParams);
        default:
          throw new Error(`Unknown intelligence type: ${String(type)}`);
      }
    } catch (error) {
      logger.error({ error, uri, position, type }, 'Code intelligence request failed');
      throw error;
    }
  }

  private async getHover(uri: string, position: Position): Promise<HoverResult> {
    const language = getLanguageFromUri(uri);
    const cacheKey = `${uri}:${position.line}:${position.character}`;
    const cached = await this.hoverCache.get(cacheKey, uri);

    if (cached) {
      logger.debug({ uri, position }, 'Hover cache hit');
      return this.formatHoverResult(cached);
    }

    const client = await this.clientManager.get(language, uri);
    const hover = await client.sendRequest<Hover | null>('textDocument/hover', {
      textDocument: { uri },
      position,
    });

    if (hover) {
      await this.hoverCache.set(cacheKey, hover, uri);
    }

    return this.formatHoverResult(hover);
  }

  private formatHoverResult(hover: Hover | null): HoverResult {
    if (!hover || !hover.contents) {
      return {
        type: 'hover',
        content: {},
      };
    }

    const content: HoverResult['content'] = {};

    // Extract content based on format
    if (typeof hover.contents === 'string') {
      content.documentation = hover.contents;
    } else if ('kind' in hover.contents) {
      if (hover.contents.kind === MarkupKind.Markdown) {
        const text = hover.contents.value;

        // Parse markdown to extract structured content
        const tokens = marked.lexer(text);

        // Look for code blocks that contain type information
        for (const token of tokens) {
          if (token.type === 'code' && !content.type && 'text' in token && token.text) {
            content.type = String(token.text).trim();
          } else if (
            (token.type === 'paragraph' || token.type === 'text') &&
            'raw' in token &&
            token.raw
          ) {
            content.documentation = (content.documentation || '') + String(token.raw);
          }
        }

        // Clean up documentation
        if (content.documentation) {
          content.documentation = content.documentation.trim();
        }
      } else {
        content.documentation = hover.contents.value;
      }
    } else if (Array.isArray(hover.contents)) {
      // Handle array of MarkedString
      for (const item of hover.contents) {
        if (typeof item === 'string') {
          content.documentation = (content.documentation || '') + '\n' + item;
        } else if ('language' in item) {
          content.type = item.value;
        }
      }
    }

    // Try to extract usage examples from documentation
    if (content.documentation) {
      const exampleMatch = content.documentation.match(/(?:Example|Usage):\s*(.+?)(?:\n\n|$)/is);
      if (exampleMatch && exampleMatch[1]) {
        content.examples = exampleMatch[1].trim();
      }
    }

    return {
      type: 'hover',
      content,
    };
  }

  private async getSignatureHelp(uri: string, position: Position): Promise<SignatureResult> {
    const language = getLanguageFromUri(uri);
    const cacheKey = `${uri}:${position.line}:${position.character}`;
    const cached = await this.signatureCache.get(cacheKey, uri);

    if (cached) {
      logger.debug({ uri, position }, 'Signature cache hit');
      return this.formatSignatureResult(cached);
    }

    const client = await this.clientManager.get(language, uri);
    const signatureHelp = await client.sendRequest<SignatureHelp | null>(
      'textDocument/signatureHelp',
      {
        textDocument: { uri },
        position,
      }
    );

    if (signatureHelp) {
      await this.signatureCache.set(cacheKey, signatureHelp, uri);
    }

    return this.formatSignatureResult(signatureHelp);
  }

  private formatSignatureResult(signatureHelp: SignatureHelp | null): SignatureResult {
    if (!signatureHelp || !signatureHelp.signatures || signatureHelp.signatures.length === 0) {
      return {
        type: 'signature',
        signatures: [],
      };
    }

    const signatures = signatureHelp.signatures.map((sig) => {
      const parameters =
        sig.parameters?.map((param) => {
          const label =
            typeof param.label === 'string'
              ? param.label
              : sig.label.substring(param.label[0], param.label[1]);

          let doc: string | undefined;
          if (param.documentation) {
            if (typeof param.documentation === 'string') {
              doc = param.documentation;
            } else if ('value' in param.documentation) {
              doc = param.documentation.value;
            }
          }

          return { label, doc };
        }) || [];

      return {
        label: sig.label,
        parameters,
        activeParameter: sig.activeParameter,
      };
    });

    return {
      type: 'signature',
      signatures,
    };
  }

  private async getCompletions(
    uri: string,
    position: Position,
    params: CodeIntelligenceParams
  ): Promise<CompletionResult> {
    const language = getLanguageFromUri(uri);
    const client = await this.clientManager.get(language, uri);

    const completionParams: {
      textDocument: { uri: string };
      position: Position;
      context?: { triggerKind: number; triggerCharacter?: string };
    } = {
      textDocument: { uri },
      position,
    };

    if (params.completionContext) {
      completionParams.context = {
        triggerKind: params.completionContext.triggerKind || CompletionTriggerKind.Invoked,
        triggerCharacter: params.completionContext.triggerCharacter,
      };
    }

    const completions = await client.sendRequest<
      CompletionItem[] | { items: CompletionItem[] } | null
    >('textDocument/completion', completionParams);

    if (!completions) {
      return {
        type: 'completion',
        items: [],
      };
    }

    // Handle both CompletionList and CompletionItem[]
    const items = Array.isArray(completions) ? completions : (completions?.items ?? []);

    // Filter and rank completions for AI usage
    const filtered = this.filterCompletionsForAI(items, params.maxResults || DEFAULT_MAX_RESULTS);

    return {
      type: 'completion',
      items: filtered.map((item) => ({
        label: item.label,
        kind: this.getCompletionKindName(item.kind),
        detail: item.detail,
        documentation: this.extractDocumentation(item.documentation),
        insertText: item.insertText || item.label,
      })),
    };
  }

  private filterCompletionsForAI(items: CompletionItem[], maxResults: number): CompletionItem[] {
    return items
      .filter((item) => {
        // Remove deprecated items
        if (item.deprecated) return false;

        // Remove internal/private items (common patterns)
        if (item.label.startsWith('_')) return false;
        if (item.label.startsWith('$')) return false;

        // Remove test utilities unless specifically needed
        if (item.label.match(/^(test|spec|mock)/i) && !item.label.match(/^test$/i)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Prioritize by kind
        const kindPriority: Record<number, number> = {
          [CompletionItemKind.Method]: 1,
          [CompletionItemKind.Function]: 2,
          [CompletionItemKind.Property]: 3,
          [CompletionItemKind.Field]: 4,
          [CompletionItemKind.Variable]: 5,
          [CompletionItemKind.Class]: 6,
          [CompletionItemKind.Interface]: 7,
          [CompletionItemKind.Module]: 8,
          [CompletionItemKind.Constant]: 9,
        };

        const aPriority = kindPriority[a.kind || 0] || 99;
        const bPriority = kindPriority[b.kind || 0] || 99;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        // Then by sort text or label
        const aSort = a.sortText || a.label;
        const bSort = b.sortText || b.label;
        return aSort.localeCompare(bSort);
      })
      .slice(0, maxResults);
  }

  private getCompletionKindName(kind?: CompletionItemKind): string {
    if (!kind) return 'unknown';

    const kindNames: Record<CompletionItemKind, string> = {
      [CompletionItemKind.Text]: 'text',
      [CompletionItemKind.Method]: 'method',
      [CompletionItemKind.Function]: 'function',
      [CompletionItemKind.Constructor]: 'constructor',
      [CompletionItemKind.Field]: 'field',
      [CompletionItemKind.Variable]: 'variable',
      [CompletionItemKind.Class]: 'class',
      [CompletionItemKind.Interface]: 'interface',
      [CompletionItemKind.Module]: 'module',
      [CompletionItemKind.Property]: 'property',
      [CompletionItemKind.Unit]: 'unit',
      [CompletionItemKind.Value]: 'value',
      [CompletionItemKind.Enum]: 'enum',
      [CompletionItemKind.Keyword]: 'keyword',
      [CompletionItemKind.Snippet]: 'snippet',
      [CompletionItemKind.Color]: 'color',
      [CompletionItemKind.File]: 'file',
      [CompletionItemKind.Reference]: 'reference',
      [CompletionItemKind.Folder]: 'folder',
      [CompletionItemKind.EnumMember]: 'enumMember',
      [CompletionItemKind.Constant]: 'constant',
      [CompletionItemKind.Struct]: 'struct',
      [CompletionItemKind.Event]: 'event',
      [CompletionItemKind.Operator]: 'operator',
      [CompletionItemKind.TypeParameter]: 'typeParameter',
    };

    return kindNames[kind] || 'unknown';
  }

  private extractDocumentation(doc?: string | { kind: string; value: string }): string | undefined {
    if (!doc) return undefined;

    if (typeof doc === 'string') {
      return doc;
    }

    return doc.value;
  }

  /**
   * Invalidate cache entries for a specific file.
   * This should be called when a file is modified.
   */
  invalidateFileCache(fileUri: string): void {
    this.hoverCache.invalidateFile(fileUri);
    this.signatureCache.invalidateFile(fileUri);
    logger.info({ fileUri }, 'Invalidated code intelligence cache for file');
  }

  /**
   * Clear all cached entries.
   */
  clearCache(): void {
    this.hoverCache.clear();
    this.signatureCache.clear();
    logger.info('Cleared all code intelligence caches');
  }
}
