# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lsmcp** - Language Server Protocol MCP - An experimental project for building an MCP (Model Context Protocol) for the Language Server Protocol (LSP).

This project aims to create an MCP implementation that can communicate with LSP servers, potentially enabling AI models to access code intelligence features like auto-completion, go-to-definition, find-references, and other language-specific capabilities.

## Project Status

The project has a comprehensive implementation plan (see PLAN.md) and foundational setup is complete. The repository contains:
- Basic project documentation (README.md)
- Comprehensive implementation plan (PLAN.md)
- Apache License 2.0
- Node.js/JavaScript .gitignore configuration
- MCP configuration (.mcp.json) with context7 integration
- **✅ TypeScript project with strict ESM configuration**
- **✅ Jest testing framework with unit, integration, and efficiency suites**
- **✅ GitHub Actions CI/CD pipeline with matrix testing**
- **✅ Basic MCP server with health check functionality**

## Container-First Architecture

✅ **NEW APPROACH** - The project now runs in Docker containers to solve cross-platform compatibility issues:

- **Docker Container**: MCP server runs inside container with language servers pre-installed
- **Consistent Path Mounting**: User's code is mounted at the same path as the host system
- **Safe Auto-Installation**: Language servers can be safely installed within container isolation
- **Windows Compatibility**: Eliminates Windows-specific LSP server installation issues

## Development Setup

✅ **COMPLETED** - The project now has a fully functional TypeScript setup with:

1. **TypeScript project**: Strict TypeScript configuration with ESM modules
2. **Testing framework**: Jest configured for ESM with unit, integration, and efficiency test suites
3. **Core dependencies installed**:
   - `@modelcontextprotocol/sdk` - MCP server implementation
   - `pino` - High-performance logging
   - TypeScript, tsx, and type definitions
4. **CI/CD**: GitHub Actions pipeline configured with matrix testing and coverage reporting

### ✅ Issue #2 Complete - LSP Client Manager Implementation
   - `vscode-languageclient` & `vscode-languageserver-protocol` - Installed and integrated
   - Connection pooling with health monitoring implemented
   - Error handling and recovery system in place
   - Modular architecture with separate components:
     - `client-v2.ts` - Main LSP client
     - `process-manager.ts` - Process lifecycle management
     - `protocol-handler.ts` - LSP protocol communication
     - `manager.ts` - Connection pool with health monitoring
     - `errors.ts` - Custom error types and recovery logic

### ✅ Tool Framework Complete (Week 1, Day 4-5)
   - **Base tool classes**: Abstract base classes for tools with support for batching and streaming
     - `base.ts` - BaseTool, BatchableTool, StreamingTool classes
   - **Tool registry**: Central registry for managing tool instances
     - `registry.ts` - ToolRegistry for registration and execution
   - **Request routing**: Intelligent routing with progress tracking and cancellation
     - `router.ts` - ToolRouter with batch processing and streaming support
   - **Integration**: Server now uses the tool framework for all tool management
   - **Code Intelligence Tool**: Updated to use the new framework with proper typing

### ✅ Issue #4 Complete - TypeScript/JavaScript Language Support
   - **Language Detection**: Automatic detection of project language
     - `detector.ts` - Detects language from tsconfig.json, jsconfig.json, package.json
     - Support for file extension-based detection
   - **TypeScript Language Server Provider**: Auto-installation and management
     - `typescript-provider.ts` - Handles typescript-language-server lifecycle
     - Automatic installation via npm/yarn when missing
   - **ConnectionPool Integration**: 
     - Support for `'auto'` language parameter for automatic detection
     - `getForFile()` method for file-based language detection
   - **Comprehensive Testing**: Unit and integration tests with mocking


### Next dependencies to install (when needed):
   - `p-queue` - Request queuing and batching (for Issue #3)

## Architecture Overview

The project implements:

1. **5 Combined MCP Tools**: Minimizing prompt overhead while maintaining clarity
   - `navigate` - Definition, implementation, and type navigation
   - `getCodeIntelligence` - Hover, signatures, and completions
   - `findSymbols` - Document and workspace symbol search
   - `findUsages` - References and call hierarchy
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

### Container Commands (Production):
- Build Docker image: `npm run docker:build`
- Run in container: `npm run docker:run`
- Use docker compose: `npm run docker:compose`

### Native Development Commands:
- Install dependencies: `npm install`
- Run development server: `npm run dev`
- Run tests: `npm test`
- Run specific test suites:
  - Unit tests: `npm run test:unit`
  - Integration tests: `npm run test:integration`
  - Efficiency benchmarks: `npm run test:efficiency`
- Type checking: `npm run type-check`
- Linting: `npm run lint`
- Build for production: `npm run build`

### MCP Configuration:
- **Production**: Use `lsmcp` server (runs in Docker)
- **Development**: Use `lsmcp-dev` server (runs natively)

## Key Technologies

- **Language**: TypeScript with strict mode
- **Runtime**: Node.js 20+
- **Protocols**: 
  - MCP (Model Context Protocol) for AI agent communication
  - LSP (Language Server Protocol) for code intelligence
- **Key Libraries**:
  - `@modelcontextprotocol/sdk` - MCP server
  - `vscode-languageclient` - LSP client
  - `jest` - Testing framework
  - `pino` - Logging
- **Supported Languages**:
  - ✅ TypeScript/JavaScript (fully implemented)
  - ✅ Python (fully implemented with virtual environment detection)
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
- **Code File Size**: Don't let code files get too big (e.g. > 1000 lines in a file is a major code smell). Ensure that everything is factored properly, modular, and minimizes code duplication.

## Development Best Practices

- **Asynchronous Programming**:
  - async is better than sync in virtually any case that's got blocking I/O, etc.
- **Testing**:
  - Never silently skip tests. If a test needs to be skipped, it should do so visibly. But also, this should be an extremely rare occurrence -- prioritize fixing the underlying reason for skipping the test over skipping it

## Version Control and Branching Strategy

- **New work that will ultimately become a PR should happen in a branch**

## Tooling Considerations

- All of the idempotent (e.g. read-only) LSP tools should have retries built in to account for LSP indexing lag