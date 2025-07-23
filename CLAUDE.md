# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lsmcp** - Language Server Protocol MCP - An experimental project for building an MCP (Model Context Protocol) for the Language Server Protocol (LSP).

This project aims to create an MCP implementation that can communicate with LSP servers, potentially enabling AI models to access code intelligence features like auto-completion, go-to-definition, find-references, and other language-specific capabilities.

## Project Status

The project now has a comprehensive implementation plan (see PLAN.md) and is ready for development. The repository contains:
- Basic project documentation (README.md)
- Comprehensive implementation plan (PLAN.md)
- Apache License 2.0
- Node.js/JavaScript .gitignore configuration
- MCP configuration (.mcp.json) with context7 integration

## Development Setup

The project will use a test-first approach with TypeScript. Initial setup steps:

1. **Initialize TypeScript project**: Create `package.json` and `tsconfig.json` with strict settings
2. **Set up testing**: Jest with unit, integration, and efficiency test suites
3. **Install core dependencies**:
   - `@modelcontextprotocol/sdk` - MCP server implementation
   - `vscode-languageclient` & `vscode-languageserver-protocol` - LSP communication
   - `pino` - High-performance logging
   - `p-queue` - Request queuing and batching
4. **Set up CI/CD**: GitHub Actions pipeline from day 1

## Architecture Overview

The project implements:

1. **6 Combined MCP Tools**: Minimizing prompt overhead while maintaining clarity
   - `navigate` - Definition, implementation, and type navigation
   - `getCodeIntelligence` - Hover, signatures, and completions
   - `findSymbols` - Document and workspace symbol search
   - `findUsages` - References and call hierarchy
   - `applyEdit` - Code actions, rename, format with transaction support
   - `getDiagnostics` - Errors, warnings, and quick fixes

2. **Key Design Decisions**:
   - Batch operations by default for efficiency
   - Configurable result limits on all operations
   - Streaming responses with progress for large results
   - Transaction-based editing with automatic rollback
   - Static configuration via MCP config file
   - Zero-config support for 10+ common languages

3. **Performance Goals**:
   - 50% context reduction vs filesystem operations
   - 2-5x fewer operations for common tasks
   - Graceful degradation with filesystem fallback suggestions

## Common Development Tasks

Development commands:
- Install dependencies: `npm install`
- Run development server: `npm run dev`
- Run tests: `npm test`
- Run specific test suites:
  - Unit tests: `npm run test:unit`
  - Integration tests: `npm run test:integration`
  - Efficiency benchmarks: `npm run benchmark:efficiency`
- Type checking: `npm run type-check`
- Linting: `npm run lint`
- Build for production: `npm run build`

## Key Technologies

- **Language**: TypeScript with strict mode
- **Runtime**: Node.js 18+
- **Protocols**: 
  - MCP (Model Context Protocol) for AI agent communication
  - LSP (Language Server Protocol) for code intelligence
- **Key Libraries**:
  - `@modelcontextprotocol/sdk` - MCP server
  - `vscode-languageclient` - LSP client
  - `jest` - Testing framework
  - `pino` - Logging
- **Supported Languages** (initial):
  - TypeScript/JavaScript
  - Python
  - (Extensible to any LSP-compatible language)
- **License**: Apache License 2.0

## Testing Strategy

The project follows test-first development:

1. **Unit Tests**: Test individual components in isolation
2. **Integration Tests**: Test with real language servers
3. **Efficiency Tests**: Measure context and operation reduction
4. **E2E Tests**: Complete AI agent workflows

Every PR must include:
- Tests for new functionality
- Efficiency benchmarks
- No regression in existing tests

## Development Guidance

- Always keep CLAUDE.md up to date with changes that you make
- Follow test-first development - write tests before implementation
- Measure efficiency gains for every feature
- Document performance improvements in code comments
- Use TypeScript strict mode for all code
- Implement graceful error handling with fallback suggestions