/**
 * Benchmark scenarios for all MCP-LSP tools
 * These scenarios compare LSP operations vs filesystem alternatives
 *
 * @note expectedReduction values represent target percentage reductions:
 *   - context: Expected reduction in context tokens (0-100%)
 *   - operations: Expected reduction in operation count (0-100%)
 *   Example: context: 70 means we expect 70% fewer context tokens with LSP
 */

import { BenchmarkScenario } from './framework.js';

// Navigate Tool Benchmarks
export const navigateScenarios: BenchmarkScenario[] = [
  {
    name: 'Find function definition in same file',
    description: 'Navigate to function definition within the same file',
    filesystemOperations: [
      'read file',
      'search for function name',
      'manual pattern matching',
      'verify signature',
    ],
    lspOperations: ['lsp.textDocument/definition'],
    expectedReduction: {
      context: 70,
      operations: 75,
    },
  },
  {
    name: 'Find class definition across project',
    description: 'Navigate to class definition in different file',
    filesystemOperations: [
      'grep -r "class ClassName"',
      'read matching files (5)',
      'filter false positives',
      'verify correct match',
      'open target file',
    ],
    lspOperations: ['lsp.textDocument/definition', 'lsp.textDocument/didOpen'],
    expectedReduction: {
      context: 80,
      operations: 60,
    },
  },
  {
    name: 'Find interface implementation',
    description: 'Navigate to concrete implementations of an interface',
    filesystemOperations: [
      'grep -r "implements InterfaceName"',
      'read all matching files (10)',
      'parse import statements',
      'verify correct interface',
      'trace inheritance chain',
      'filter and sort results',
    ],
    lspOperations: ['lsp.textDocument/implementation'],
    expectedReduction: {
      context: 90,
      operations: 83,
    },
  },
  {
    name: 'Navigate to type definition',
    description: 'Find where a type is defined',
    filesystemOperations: [
      'grep -r "type TypeName"',
      'grep -r "interface TypeName"',
      'grep -r "class TypeName"',
      'read matching files',
      'disambiguate duplicates',
    ],
    lspOperations: ['lsp.textDocument/typeDefinition'],
    expectedReduction: {
      context: 85,
      operations: 80,
    },
  },
];

// Find Usages Benchmarks
export const findUsagesScenarios: BenchmarkScenario[] = [
  {
    name: 'Find all references to popular function',
    description: 'Find all calls to a frequently used utility function',
    filesystemOperations: [
      'grep -r "functionName"',
      'read all matching files (50)',
      'filter false positives (comments, strings)',
      'parse context for each match',
      'verify actual function calls',
      'extract surrounding code',
    ],
    lspOperations: ['lsp.textDocument/references'],
    expectedReduction: {
      context: 90,
      operations: 83,
    },
  },
  {
    name: 'Trace call hierarchy 3 levels deep',
    description: 'Find all callers and callees of a function',
    filesystemOperations: [
      'grep for function definition',
      'grep for direct calls',
      'read files with calls',
      'find callers of callers',
      'grep for each caller',
      'read their files',
      'find callers of those',
      'grep again',
      'read more files',
      'build call graph manually',
      'remove duplicates',
      'format results',
    ],
    lspOperations: [
      'lsp.callHierarchy/incomingCalls',
      'lsp.callHierarchy/incomingCalls (level 2)',
      'lsp.callHierarchy/incomingCalls (level 3)',
    ],
    expectedReduction: {
      context: 95,
      operations: 75,
    },
  },
  {
    name: 'Find variable usages across module',
    description: 'Track all usages of an exported variable',
    filesystemOperations: [
      'grep for variable name',
      'read all files',
      'check import statements',
      'track aliased imports',
      'follow re-exports',
      'parse destructuring',
    ],
    lspOperations: ['lsp.textDocument/references'],
    expectedReduction: {
      context: 88,
      operations: 80,
    },
  },
];

// Symbol Search Benchmarks
export const symbolSearchScenarios: BenchmarkScenario[] = [
  {
    name: 'Search for class by name',
    description: 'Find all classes matching a pattern',
    filesystemOperations: [
      'grep -r "class.*Pattern"',
      'read matching files',
      'parse class definitions',
      'extract class metadata',
      'filter by visibility',
    ],
    lspOperations: ['lsp.workspace/symbol'],
    expectedReduction: {
      context: 85,
      operations: 80,
    },
  },
  {
    name: 'Find all functions in file',
    description: 'List all function definitions in a file',
    filesystemOperations: [
      'read entire file',
      'regex match functions',
      'parse arrow functions',
      'parse method definitions',
      'extract signatures',
      'build hierarchy',
    ],
    lspOperations: ['lsp.textDocument/documentSymbol'],
    expectedReduction: {
      context: 70,
      operations: 85,
    },
  },
  {
    name: 'Fuzzy search for symbols',
    description: 'Find symbols using partial/fuzzy matching',
    filesystemOperations: [
      'grep with complex regex',
      'read all potential matches',
      'implement fuzzy matching',
      'score and rank results',
      'filter by threshold',
    ],
    lspOperations: ['lsp.workspace/symbol with fuzzy query'],
    expectedReduction: {
      context: 90,
      operations: 80,
    },
  },
];

// Code Intelligence Benchmarks
export const codeIntelligenceScenarios: BenchmarkScenario[] = [
  {
    name: 'Get hover information',
    description: 'Get type info and documentation on hover',
    filesystemOperations: [
      'read current file',
      'parse AST',
      'find symbol at position',
      'trace type definition',
      'read type file',
      'extract JSDoc comments',
      'format documentation',
    ],
    lspOperations: ['lsp.textDocument/hover'],
    expectedReduction: {
      context: 85,
      operations: 85,
    },
  },
  {
    name: 'Get function signature help',
    description: 'Get parameter hints while typing',
    filesystemOperations: [
      'read file',
      'find function definition',
      'parse parameters',
      'extract parameter docs',
      'handle overloads',
    ],
    lspOperations: ['lsp.textDocument/signatureHelp'],
    expectedReduction: {
      context: 80,
      operations: 80,
    },
  },
  {
    name: 'Get auto-completions',
    description: 'Get context-aware code completions',
    filesystemOperations: [
      'read current file',
      'parse imports',
      'read imported modules',
      'extract exports',
      'read type definitions',
      'filter by context',
      'rank by relevance',
      'read documentation',
    ],
    lspOperations: ['lsp.textDocument/completion'],
    expectedReduction: {
      context: 90,
      operations: 85,
    },
  },
];

// Diagnostics Benchmarks
export const diagnosticsScenarios: BenchmarkScenario[] = [
  {
    name: 'Get all errors in project',
    description: 'Find all TypeScript errors in project',
    filesystemOperations: [
      'run tsc --noEmit',
      'parse TypeScript output',
      'extract file locations',
      'parse error messages',
      'run eslint',
      'parse ESLint output',
      'merge results',
      'deduplicate',
      'read files for context',
    ],
    lspOperations: ['lsp.workspace/diagnostic'],
    expectedReduction: {
      context: 85,
      operations: 88,
    },
  },
  {
    name: 'Get diagnostics with quick fixes',
    description: 'Get errors with suggested fixes',
    filesystemOperations: [
      'run linter with fixes',
      'parse output',
      'extract fix suggestions',
      'read documentation',
      'format fixes',
      'verify applicability',
    ],
    lspOperations: ['lsp.textDocument/diagnostic', 'lsp.textDocument/codeAction'],
    expectedReduction: {
      context: 80,
      operations: 70,
    },
  },
  {
    name: 'Filter diagnostics by severity',
    description: 'Get only error-level diagnostics',
    filesystemOperations: [
      'run type checker',
      'filter output by severity',
      'parse filtered results',
      'extract locations',
      'read context',
    ],
    lspOperations: ['lsp.workspace/diagnostic with severity filter'],
    expectedReduction: {
      context: 75,
      operations: 80,
    },
  },
];

// Composite scenarios that use multiple tools
export const compositeScenarios: BenchmarkScenario[] = [
  {
    name: 'Complete refactoring workflow',
    description: 'Find, rename, and verify a symbol refactoring',
    filesystemOperations: [
      'grep for symbol definition',
      'grep for all usages',
      'read all files',
      'perform renames',
      'write all files',
      'run type checker',
      'parse errors',
      'fix broken imports',
      'run tests',
    ],
    lspOperations: [
      'lsp.textDocument/definition',
      'lsp.textDocument/references',
      'lsp.textDocument/rename',
      'lsp.workspace/diagnostic',
    ],
    expectedReduction: {
      context: 92,
      operations: 85,
    },
  },
  {
    name: 'Debug type error',
    description: 'Understand and fix a complex type error',
    filesystemOperations: [
      'run tsc',
      'parse error',
      'read error location',
      'find type definition',
      'read type file',
      'trace type hierarchy',
      'read related types',
      'identify issue',
      'apply fix',
      'verify fix',
    ],
    lspOperations: [
      'lsp.textDocument/diagnostic',
      'lsp.textDocument/hover',
      'lsp.textDocument/definition',
      'lsp.textDocument/codeAction',
    ],
    expectedReduction: {
      context: 88,
      operations: 70,
    },
  },
];

// All scenarios combined
export const allScenarios: BenchmarkScenario[] = [
  ...navigateScenarios,
  ...findUsagesScenarios,
  ...symbolSearchScenarios,
  ...codeIntelligenceScenarios,
  ...diagnosticsScenarios,
  ...compositeScenarios,
];
