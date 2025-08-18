# LSMCP - Language Server Protocol MCP

An experimental Model Context Protocol (MCP) implementation that provides AI models with access to Language Server Protocol (LSP) capabilities.

## Overview

This project creates an MCP server that communicates with LSP servers, enabling AI models to access code intelligence features like auto-completion, go-to-definition, find-references, and other language-specific capabilities.

## Status

✅ **Container-Ready** - The project now runs in Docker containers for cross-platform compatibility.

## Quick Start

### Using Docker (Recommended)

1. **Build the container:**
   ```bash
   git clone https://github.com/depoll/lsmcp.git
   cd lsmcp
   npm run docker:build
   ```

2. **Configure your MCP client** to use the `lsmcp` server from `.mcp.json`

3. **The container will:**
   - Mount your working directory at the same path as your host system
   - Provide pre-installed language servers for TypeScript, Python, Go, Rust, etc.
   - Automatically detect project languages and provide code intelligence

### Development Setup

For development and testing:

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run specific test suites
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:efficiency  # Efficiency benchmarks

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build
```

## Features

- **8 MCP Tools** for code intelligence and refactoring:
  - `navigate` - Definition, implementation, and type navigation
  - `getCodeIntelligence` - Hover info, signatures, and completions
  - `findSymbols` - Document and workspace symbol search
  - `findUsages` - References and call hierarchy
  - `getDiagnostics` - Errors, warnings, and quick fixes
  - `renameSymbol` - Semantic symbol renaming across files
  - `applyCodeAction` - Apply quick fixes and refactorings
  - `executeCommand` - Execute language-specific commands

- **Container-First Architecture**:
  - Eliminates Windows compatibility issues
  - Safe automatic language server installation
  - Consistent environment across platforms

- **Zero-Config Language Support**:
  - Automatic language detection
  - Pre-installed language servers
  - Support for 20+ programming languages

## Supported Languages

### Fully Implemented with Providers

- **TypeScript/JavaScript** - Full support with automatic project detection
- **Python** - Pyright for advanced type checking and language features
- **Rust** - rust-analyzer for Rust projects
- **Go** - gopls for Go modules and packages
- **C#/.NET** - OmniSharp for C# development
- **Java** - Eclipse JDT.LS for Java projects
- **C/C++/Objective-C** - clangd for C-family languages
- **Bash/Shell** - bash-language-server for shell scripts
- **JSON** - Schema validation and IntelliSense
- **YAML** - YAML language server with schema support
- **HTML** - HTML language server with tag completion
- **CSS/SCSS/SASS/LESS** - CSS language server with property completion
- **Ruby** - Solargraph for Ruby development
- **PHP** - Intelephense for PHP projects
- **Kotlin** - Kotlin language server
- **Swift** - SourceKit-LSP for Swift development

## Architecture

The system runs inside a Docker container with:
- Your workspace mounted at the same path as your host system
- Language servers pre-installed and configured
- Automatic language detection and connection pooling
- Health monitoring and crash recovery

## Troubleshooting

If the MCP server doesn't load in Claude Code:

1. **Build the Docker image first:**
   ```bash
   npm run docker:build
   ```

2. **Run the debug script:**
   ```bash
   npm run debug:mcp
   ```

3. **Try the alternative configuration:**
   - Use `lsmcp-simple` instead of `lsmcp` in your MCP client
   - This uses `/workspace` mounting as fallback

4. **Check Docker connectivity:**
   - Ensure Docker Desktop is running
   - Verify Claude Code can access Docker daemon

5. **Manual testing:**
   ```bash
   echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | docker run --rm -i -v "$(pwd):$(pwd)" -w "$(pwd)" lsmcp:latest
   ```

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed development instructions and architecture overview.

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.