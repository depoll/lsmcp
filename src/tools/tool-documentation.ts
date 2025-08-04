/**
 * Enhanced MCP Tool Documentation
 *
 * This file contains comprehensive documentation for all MCP tools in the lsmcp project.
 * Each tool includes detailed parameter descriptions, usage scenarios, and examples.
 */

/**
 * Note: This file contains human-readable documentation for reference.
 * The actual parameter descriptions used by the tools are defined in each tool's implementation file.
 * This ensures the MCP protocol receives the full, detailed descriptions directly from the schemas.
 */
export const TOOL_DOCUMENTATION = {
  getCodeIntelligence: {
    name: 'getCodeIntelligence',
    description: 'Get hover info, signatures, or completions at a position',
    detailedDescription: `
Retrieves code intelligence information at a specific position in a file. This tool provides three types of intelligence:

1. **Hover**: Shows type information, documentation, and usage examples for symbols
2. **Signature**: Displays function signatures with parameter information and documentation
3. **Completion**: Suggests code completions with intelligent filtering and ranking

The tool uses caching to improve performance and applies AI-optimized filtering to provide the most relevant results.
    `.trim(),
    parameters: {
      uri: {
        type: 'string',
        required: true,
        description: 'File URI (e.g., file:///path/to/file.ts)',
        examples: [
          'file:///home/user/project/src/index.ts',
          'file:///Users/john/Code/app/lib/utils.js',
          'file:///C:/Projects/MyApp/main.py',
        ],
        validation: 'Must be a valid file:// URI with proper encoding for special characters',
      },
      position: {
        type: 'object',
        required: true,
        description: 'Zero-based position in the file',
        properties: {
          line: {
            type: 'number',
            description: 'Zero-based line number',
            validation: 'Must be >= 0 and within file bounds',
          },
          character: {
            type: 'number',
            description: 'Zero-based character offset within the line',
            validation: 'Must be >= 0 and within line bounds',
          },
        },
        examples: [
          '{ line: 10, character: 15 } - Position at line 11, column 16 in editor',
          '{ line: 0, character: 0 } - Beginning of file',
          '{ line: 42, character: 8 } - Inside a function name',
        ],
      },
      type: {
        type: 'string',
        required: true,
        enum: ['hover', 'signature', 'completion'],
        description: 'Type of intelligence to retrieve',
        details: {
          hover: 'Get type info, documentation, and examples for symbol at position',
          signature: 'Get function signature help while typing arguments',
          completion: 'Get context-aware code completion suggestions',
        },
      },
      completionContext: {
        type: 'object',
        required: false,
        description: 'Additional context for completion requests',
        appliesTo: 'Only used when type is "completion"',
        properties: {
          triggerCharacter: {
            type: 'string',
            required: false,
            description: 'Character that triggered completion (e.g., ".")',
            examples: ['.', '(', '[', '"', "'", '<', '/', '@'],
            usage: 'Helps language server provide character-specific completions',
          },
          triggerKind: {
            type: 'number',
            required: false,
            description: 'How completion was triggered',
            enum: {
              1: 'Invoked - Explicitly requested by user',
              2: 'TriggerCharacter - Triggered by typing a special character',
              3: 'Incomplete - Re-triggered due to incomplete previous result',
            },
          },
        },
      },
      maxResults: {
        type: 'number',
        required: false,
        default: 50,
        description: 'Maximum number of completion items to return',
        appliesTo: 'Only used when type is "completion"',
        validation: 'Must be > 0, recommended range: 10-200',
      },
    },
    scenarios: [
      {
        name: 'Get type information on hover',
        description: 'Show type info when hovering over a variable',
        example: {
          params: {
            uri: 'file:///src/app.ts',
            position: { line: 25, character: 12 },
            type: 'hover',
          },
          expectedResult: {
            type: 'hover',
            content: {
              type: 'const user: User',
              documentation: 'Represents a user in the system',
              examples: 'const user = new User("john@example.com");',
            },
          },
        },
      },
      {
        name: 'Get function signature help',
        description: 'Show parameter info while calling a function',
        example: {
          params: {
            uri: 'file:///src/utils.ts',
            position: { line: 15, character: 20 },
            type: 'signature',
          },
          expectedResult: {
            type: 'signature',
            signatures: [
              {
                label: 'processData(data: string[], options?: ProcessOptions): Promise<Result>',
                parameters: [
                  { label: 'data: string[]', doc: 'Array of data to process' },
                  { label: 'options?: ProcessOptions', doc: 'Optional processing configuration' },
                ],
                activeParameter: 0,
              },
            ],
          },
        },
      },
      {
        name: 'Get smart completions after dot',
        description: 'Get method/property completions after typing a dot',
        example: {
          params: {
            uri: 'file:///src/models.ts',
            position: { line: 30, character: 8 },
            type: 'completion',
            completionContext: {
              triggerCharacter: '.',
              triggerKind: 2,
            },
            maxResults: 20,
          },
          expectedResult: {
            type: 'completion',
            items: [
              {
                label: 'save',
                kind: 'method',
                detail: '(): Promise<void>',
                documentation: 'Saves the model to the database',
                insertText: 'save()',
              },
              {
                label: 'validate',
                kind: 'method',
                detail: '(): ValidationResult',
                documentation: 'Validates the model data',
                insertText: 'validate()',
              },
            ],
          },
        },
      },
    ],
    errorHandling: {
      noLanguageServer: 'Returns empty result with appropriate type',
      invalidPosition: 'Returns empty result if position is out of bounds',
      timeouts: 'Cached results may be returned if available',
    },
    performance: {
      caching: 'Hover and signature results are cached for 5 minutes',
      filtering: 'Completions are filtered to remove deprecated/internal items',
      ranking: 'Completions are ranked by relevance (methods > properties > others)',
    },
  },

  navigate: {
    name: 'navigate',
    description: 'Navigate to definitions, implementations, or type definitions',
    detailedDescription: `
Finds and navigates to symbol definitions, implementations, or type definitions. Supports both single and batch navigation requests.

Key features:
- **Definition**: Jump to where a symbol is defined
- **Implementation**: Find concrete implementations of interfaces/abstract classes
- **Type Definition**: Navigate to type declarations

The tool automatically sorts results by relevance (same file > same directory > by distance) and provides fallback grep suggestions when language server navigation fails.
    `.trim(),
    parameters: {
      uri: {
        type: 'string',
        required: 'For single navigation',
        description: 'File URI to navigate from',
        examples: ['file:///src/components/Button.tsx', 'file:///lib/database/connection.ts'],
      },
      position: {
        type: 'object',
        required: 'For single navigation',
        description: 'Position of the symbol to navigate from',
        properties: {
          line: { type: 'number', description: 'Zero-based line number' },
          character: { type: 'number', description: 'Zero-based character offset' },
        },
      },
      target: {
        type: 'string',
        required: 'For single navigation',
        enum: ['definition', 'implementation', 'typeDefinition'],
        description: 'Navigation target type',
        details: {
          definition: 'Go to where the symbol is defined (variable, function, class declaration)',
          implementation: 'Find implementations of an interface or abstract class',
          typeDefinition: 'Navigate to the type declaration of a symbol',
        },
      },
      batch: {
        type: 'array',
        required: false,
        description: 'Batch navigation requests for multiple symbols',
        items: {
          uri: 'string - File URI',
          position: 'object - Position with line and character',
          target: 'string - Navigation target type',
        },
        usage: 'Use batch mode to navigate multiple symbols efficiently in one request',
      },
      maxResults: {
        type: 'number',
        required: false,
        default: 100,
        description: 'Maximum results per navigation request',
        validation: 'Must be > 0, results are sorted by relevance',
      },
    },
    scenarios: [
      {
        name: 'Go to function definition',
        description: 'Navigate to where a function is defined',
        example: {
          params: {
            uri: 'file:///src/app.ts',
            position: { line: 50, character: 10 },
            target: 'definition',
          },
          expectedResult: {
            results: [
              {
                uri: 'file:///src/utils/helpers.ts',
                range: {
                  start: { line: 15, character: 0 },
                  end: { line: 15, character: 20 },
                },
                preview: 'export function processUser(data: UserData) {',
                kind: 'definition',
              },
            ],
          },
        },
      },
      {
        name: 'Find interface implementations',
        description: 'Find all classes implementing an interface',
        example: {
          params: {
            uri: 'file:///src/interfaces/storage.ts',
            position: { line: 5, character: 10 },
            target: 'implementation',
            maxResults: 50,
          },
          expectedResult: {
            results: [
              {
                uri: 'file:///src/storage/local.ts',
                range: { start: { line: 10, character: 0 }, end: { line: 10, character: 30 } },
                preview: 'export class LocalStorage implements IStorage {',
              },
              {
                uri: 'file:///src/storage/cloud.ts',
                range: { start: { line: 8, character: 0 }, end: { line: 8, character: 30 } },
                preview: 'export class CloudStorage implements IStorage {',
              },
            ],
          },
        },
      },
      {
        name: 'Batch navigation for multiple symbols',
        description: 'Navigate to definitions of multiple symbols in one request',
        example: {
          params: {
            batch: [
              {
                uri: 'file:///src/main.ts',
                position: { line: 10, character: 5 },
                target: 'definition',
              },
              {
                uri: 'file:///src/main.ts',
                position: { line: 15, character: 8 },
                target: 'typeDefinition',
              },
            ],
            maxResults: 20,
          },
        },
      },
    ],
    errorHandling: {
      noResults: 'Returns empty results array with fallback grep suggestion',
      fallbackFormat: 'Provides grep command to search for symbol manually',
      batchErrors: 'Failed items in batch return individual fallback suggestions',
    },
    performance: {
      caching: 'Navigation results cached for 5 minutes per file',
      batching: 'Batch requests processed in parallel for efficiency',
      sorting: 'Results sorted by relevance: same file > same dir > by distance',
    },
  },

  findSymbols: {
    name: 'findSymbols',
    description: 'Search for symbols in current file or entire workspace',
    detailedDescription: `
Searches for symbols (functions, classes, variables, etc.) by name or pattern in either a single file or across the entire workspace.

Features:
- **Fuzzy matching**: Supports partial matches and camelCase abbreviations
- **Pattern matching**: Use wildcards (* prefix/suffix) for flexible searches
- **Kind filtering**: Filter results by symbol type
- **Smart ranking**: Results scored and sorted by relevance

The tool automatically detects project language from configuration files and provides grep fallback commands for filesystem searches.
    `.trim(),
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Symbol name or pattern to search for',
        examples: [
          'processUser - Exact name search',
          'proc* - Prefix search for symbols starting with "proc"',
          '*User - Suffix search for symbols ending with "User"',
          '*process* - Substring search',
          'pU - CamelCase abbreviation for processUser',
        ],
        validation: 'Max length: 200 characters',
      },
      scope: {
        type: 'string',
        required: true,
        enum: ['document', 'workspace'],
        description: 'Search scope',
        details: {
          document: 'Search only in the specified file (requires uri parameter)',
          workspace: 'Search across all files in the workspace',
        },
      },
      uri: {
        type: 'string',
        required: 'When scope is "document"',
        description: 'File URI for document scope search',
        validation: 'Must be provided when scope is "document"',
      },
      kind: {
        type: 'string',
        required: false,
        enum: [
          'function',
          'class',
          'interface',
          'variable',
          'constant',
          'method',
          'property',
          'enum',
        ],
        description: 'Filter results by symbol type',
        usage: 'Narrows search to specific symbol types for more focused results',
      },
      maxResults: {
        type: 'number',
        required: false,
        default: 200,
        description: 'Maximum number of results to return',
        validation: 'Must be > 0, results are sorted by relevance score',
      },
    },
    scenarios: [
      {
        name: 'Find all functions in current file',
        description: 'Search for functions in a specific file',
        example: {
          params: {
            query: '*',
            scope: 'document',
            uri: 'file:///src/utils.ts',
            kind: 'function',
            maxResults: 50,
          },
          expectedResult: {
            symbols: [
              {
                name: 'processData',
                kind: 'function',
                location: {
                  uri: 'file:///src/utils.ts',
                  range: { start: { line: 10, character: 0 }, end: { line: 10, character: 20 } },
                },
              },
              {
                name: 'validateInput',
                kind: 'function',
                location: {
                  uri: 'file:///src/utils.ts',
                  range: { start: { line: 25, character: 0 }, end: { line: 25, character: 25 } },
                },
              },
            ],
            truncated: false,
            totalFound: 2,
          },
        },
      },
      {
        name: 'Find classes by pattern in workspace',
        description: 'Search for classes matching a pattern across all files',
        example: {
          params: {
            query: '*Controller',
            scope: 'workspace',
            kind: 'class',
            maxResults: 100,
          },
          expectedResult: {
            symbols: [
              {
                name: 'UserController',
                kind: 'class',
                location: {
                  uri: 'file:///src/controllers/user.ts',
                  range: { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } },
                },
                containerName: 'controllers',
              },
              {
                name: 'AuthController',
                kind: 'class',
                location: {
                  uri: 'file:///src/controllers/auth.ts',
                  range: { start: { line: 8, character: 0 }, end: { line: 8, character: 30 } },
                },
                containerName: 'controllers',
              },
            ],
            truncated: false,
            totalFound: 2,
          },
        },
      },
      {
        name: 'Fuzzy search with camelCase',
        description: 'Find symbols using camelCase abbreviations',
        example: {
          params: {
            query: 'gUD',
            scope: 'workspace',
            maxResults: 10,
          },
          expectedResult: {
            symbols: [
              {
                name: 'getUserData',
                kind: 'function',
                location: {
                  uri: 'file:///src/api/users.ts',
                  range: {
                    /* ... */
                  },
                },
                score: 70,
              },
              {
                name: 'getUserDetails',
                kind: 'method',
                location: {
                  uri: 'file:///src/models/user.ts',
                  range: {
                    /* ... */
                  },
                },
                score: 70,
              },
            ],
          },
        },
      },
    ],
    matchingBehavior: {
      exactMatch: 'Score: 100 - Symbol name exactly matches query',
      prefixMatch: 'Score: 80 - Symbol name starts with query',
      camelCase: 'Score: 70 - Query matches camelCase abbreviation',
      substring: 'Score: 50 - Query appears anywhere in symbol name',
      pattern: 'Score: 100 - Wildcard pattern matches',
    },
    errorHandling: {
      noLanguageServer: 'Returns error with grep fallback commands',
      invalidScope: 'Throws error if document scope used without uri',
      fallbackCommands: 'Provides grep commands for filesystem search',
    },
    performance: {
      caching: 'Results cached for 10 minutes with SHA256 key',
      maxQueryLength: 'Queries limited to 200 characters',
      maxPatternLength: 'Patterns limited to 100 characters',
    },
  },

  findUsages: {
    name: 'findUsages',
    description: 'Find all references or call hierarchy for a symbol',
    detailedDescription: `
Finds all usages of a symbol across the codebase, including references and call hierarchies.

Two main modes:
1. **References**: Find all places where a symbol is used (read, write, import, etc.)
2. **Call Hierarchy**: Trace incoming/outgoing function calls to understand code flow

Supports batch processing for finding references to multiple symbols and provides streaming results for large result sets.
    `.trim(),
    parameters: {
      uri: {
        type: 'string',
        required: true,
        format: 'url',
        description: 'File URI containing the symbol',
        validation: 'Must be a valid file:// URL',
      },
      position: {
        type: 'object',
        required: true,
        description: 'Position of the symbol to find usages for',
        properties: {
          line: { type: 'number', min: 0, description: 'Zero-based line number' },
          character: { type: 'number', min: 0, description: 'Zero-based character offset' },
        },
      },
      type: {
        type: 'string',
        required: true,
        enum: ['references', 'callHierarchy'],
        description: 'Type of usage search',
        details: {
          references: 'Find all locations where the symbol is referenced',
          callHierarchy: 'Trace function calls to/from the symbol',
        },
      },
      direction: {
        type: 'string',
        required: false,
        enum: ['incoming', 'outgoing'],
        description: 'Direction for call hierarchy',
        appliesTo: 'Only used when type is "callHierarchy"',
        details: {
          incoming: 'Find all functions that call this function',
          outgoing: 'Find all functions that this function calls',
        },
      },
      batch: {
        type: 'array',
        required: false,
        description: 'Batch find references for multiple symbols',
        appliesTo: 'Only used when type is "references"',
        items: {
          uri: 'string - File URI',
          position: 'object - Position with line and character',
        },
        usage: 'Results are deduplicated across batch items',
      },
      maxResults: {
        type: 'number',
        required: true,
        min: 1,
        description: 'Maximum number of results to return',
        recommendation: 'Use 50-500 for references, 10-50 for call hierarchy',
      },
      maxDepth: {
        type: 'number',
        required: true,
        min: 1,
        max: 10,
        description: 'Maximum depth for call hierarchy traversal',
        appliesTo: 'Only used when type is "callHierarchy"',
        recommendation: '3-5 for most use cases to avoid excessive recursion',
      },
      includeDeclaration: {
        type: 'boolean',
        required: true,
        description: 'Include the declaration/definition in results',
        appliesTo: 'Only used when type is "references"',
      },
    },
    scenarios: [
      {
        name: 'Find all references to a function',
        description: 'Find everywhere a function is called or referenced',
        example: {
          params: {
            uri: 'file:///src/utils/auth.ts',
            position: { line: 20, character: 10 },
            type: 'references',
            maxResults: 100,
            maxDepth: 1,
            includeDeclaration: true,
          },
          expectedResult: {
            references: [
              {
                uri: 'file:///src/utils/auth.ts',
                range: { start: { line: 20, character: 9 }, end: { line: 20, character: 20 } },
                kind: 'declaration',
                preview: 'export function authenticate(token: string) {',
              },
              {
                uri: 'file:///src/api/login.ts',
                range: { start: { line: 15, character: 12 }, end: { line: 15, character: 23 } },
                kind: 'read',
                preview: 'const user = authenticate(req.token);',
              },
              {
                uri: 'file:///src/middleware/auth.ts',
                range: { start: { line: 8, character: 8 }, end: { line: 8, character: 19 } },
                kind: 'read',
                preview: 'return authenticate(token).then(...);',
              },
            ],
            total: 3,
          },
        },
      },
      {
        name: 'Find incoming calls to a function',
        description: 'Trace which functions call a specific function',
        example: {
          params: {
            uri: 'file:///src/services/database.ts',
            position: { line: 50, character: 15 },
            type: 'callHierarchy',
            direction: 'incoming',
            maxResults: 50,
            maxDepth: 3,
            includeDeclaration: false,
          },
          expectedResult: {
            hierarchy: {
              name: 'saveUser',
              kind: 12, // SymbolKind.Function
              uri: 'file:///src/services/database.ts',
              range: { start: { line: 50, character: 0 }, end: { line: 60, character: 1 } },
              selectionRange: {
                start: { line: 50, character: 9 },
                end: { line: 50, character: 17 },
              },
              detail: '(user: User): Promise<void>',
              calls: [
                {
                  name: 'createUser',
                  kind: 12,
                  uri: 'file:///src/api/users.ts',
                  range: { start: { line: 25, character: 0 }, end: { line: 35, character: 1 } },
                  calls: [
                    {
                      name: 'handleRegistration',
                      kind: 12,
                      uri: 'file:///src/controllers/auth.ts',
                      range: { start: { line: 40, character: 0 }, end: { line: 50, character: 1 } },
                      calls: [],
                    },
                  ],
                },
                {
                  name: 'updateUser',
                  kind: 12,
                  uri: 'file:///src/api/users.ts',
                  range: { start: { line: 40, character: 0 }, end: { line: 50, character: 1 } },
                  calls: [],
                },
              ],
            },
          },
        },
      },
      {
        name: 'Batch find references',
        description: 'Find references to multiple symbols efficiently',
        example: {
          params: {
            type: 'references',
            uri: 'file:///src/models/user.ts',
            position: { line: 10, character: 5 },
            batch: [
              { uri: 'file:///src/models/user.ts', position: { line: 10, character: 5 } },
              { uri: 'file:///src/models/user.ts', position: { line: 15, character: 8 } },
              { uri: 'file:///src/models/user.ts', position: { line: 20, character: 12 } },
            ],
            maxResults: 200,
            maxDepth: 1,
            includeDeclaration: false,
          },
        },
      },
    ],
    streamingSupport: {
      enabled: true,
      batchSize: 20,
      progressReporting: 'Reports current/total count and percentage',
      usage: 'Use streaming for large result sets to get incremental results',
    },
    errorHandling: {
      noLanguageServer: 'Throws error with descriptive message',
      invalidPosition: 'Returns empty results for out-of-bounds positions',
      cycles: 'Call hierarchy automatically detects and prevents cycles',
    },
    performance: {
      deduplication: 'Batch results are automatically deduplicated',
      workspaceLoading: 'Automatically opens related files for better results',
      streaming: 'Large result sets can be streamed in batches of 20',
    },
    limitations: {
      classification: 'Currently only distinguishes declaration vs read references',
      futureEnhancements: 'Could add write, call, import classifications with AST analysis',
    },
  },

  applyEdit: {
    name: 'applyEdit',
    description: 'Apply code modifications via LSP with automatic rollback',
    detailedDescription: `
Applies various code modifications through the Language Server Protocol with full transaction support.
All operations are atomic - if any part fails, all changes are automatically rolled back to maintain consistency.

Supported operations:
1. **Code Actions**: Apply quickfixes, refactors, and source actions
2. **Rename**: Rename symbols across the entire codebase  
3. **Format**: Format code according to language-specific rules
4. **Organize Imports**: Sort and optimize import statements

Key features:
- Transaction support with automatic rollback on failure
- Dry run mode for previewing changes
- Multiple selection strategies for code actions
- Safety limits to prevent excessive changes
- Batch operations for efficiency
    `.trim(),
    parameters: {
      type: {
        type: 'enum',
        required: true,
        values: ['codeAction', 'rename', 'format', 'organizeImports'],
        description: 'Type of edit operation to perform',
        details: {
          codeAction:
            'Apply fixes, refactors, or source actions (e.g., fix errors, extract method)',
          rename: 'Rename symbols across the codebase (variables, functions, classes)',
          format: 'Format code according to language rules',
          organizeImports: 'Sort and optimize import statements',
        },
      },
      actions: {
        type: 'array',
        required: 'Required for codeAction type',
        description: 'Code actions to apply',
        items: {
          uri: 'File URI to apply action to',
          diagnostic: 'Optional diagnostic to match specific fix',
          actionKind: 'Filter by action type: quickfix, refactor, or source',
          position: 'Position for context-aware actions',
          selectionStrategy: 'How to select from multiple actions',
          preferredKinds: 'Ordered list of preferred action kinds',
          maxActions: 'Maximum actions to apply (safety limit)',
        },
      },
      rename: {
        type: 'object',
        required: 'Required for rename type',
        description: 'Rename operation parameters',
        properties: {
          uri: 'File containing the symbol to rename',
          position: 'Zero-based position within the symbol name (line 0 = first line, subtract 1 from editor line number)',
          newName: 'New name for the symbol',
          maxFiles: 'Maximum files to modify (default: 100)',
          excludePatterns: 'Glob patterns to exclude (e.g., node_modules)',
        },
      },
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'Preview changes without applying them',
      },
      atomic: {
        type: 'boolean',
        default: true,
        description: 'Rollback all changes if any edit fails',
      },
    },
    examples: [
      {
        title: 'Fix a specific error',
        request: {
          type: 'codeAction',
          actions: [
            {
              uri: 'file:///src/app.ts',
              diagnostic: {
                message: 'Cannot find name "userService"',
                range: { start: { line: 10, character: 5 }, end: { line: 10, character: 16 } },
              },
              selectionStrategy: 'best-match',
            },
          ],
        },
        description:
          'Applies the quickfix that specifically addresses the "Cannot find name" error',
      },
      {
        title: 'Rename a function across the codebase',
        request: {
          type: 'rename',
          rename: {
            uri: 'file:///src/utils.ts',
            position: { line: 15, character: 10 }, // Zero-based: editor line 16, column 11
            newName: 'calculateTotalPrice',
            excludePatterns: ['**/tests/**', '**/node_modules/**'],
          },
        },
        description: 'Renames a function and all its references, excluding test files. Note: positions are zero-based (subtract 1 from editor line numbers)',
      },
      {
        title: 'Format multiple files',
        request: {
          type: 'format',
          format: {
            uris: ['file:///src/index.ts', 'file:///src/app.ts'],
            options: { tabSize: 2, insertSpaces: true },
          },
        },
        description: 'Formats multiple files with specific formatting options',
      },
      {
        title: 'Apply all available quickfixes',
        request: {
          type: 'codeAction',
          actions: [
            {
              uri: 'file:///src/broken.ts',
              actionKind: 'quickfix',
              selectionStrategy: 'all',
              maxActions: 3,
            },
          ],
          dryRun: true,
        },
        description: 'Preview up to 3 quickfixes without applying them',
      },
    ],
    bestPractices: {
      safety: 'Always use atomic mode (default) for production code changes',
      preview: 'Use dryRun mode to preview complex changes before applying',
      selection: 'Use "best-match" strategy when fixing specific diagnostics',
      limits: 'Set reasonable maxFiles/maxActions to prevent runaway changes',
      testing: 'Consider excluding test directories when renaming production code',
    },
    errors: {
      'No code actions available':
        'The language server found no applicable actions at the position',
      'Cannot rename at this location': 'The position does not contain a renameable symbol',
      'Transaction failed': 'One or more edits failed - all changes were rolled back',
      'No language server available': 'The file type is not supported or server is not running',
    },
  },
};
