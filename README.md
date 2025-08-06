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

- **6 Combined MCP Tools** for efficient code intelligence:
  - `navigate` - Definition, implementation, and type navigation
  - `getCodeIntelligence` - Hover info, signatures, and completions
  - `findSymbols` - Document and workspace symbol search
  - `findUsages` - References and call hierarchy
  - `applyEdit` - Code actions, rename, format with transactions
  - `getDiagnostics` - Errors, warnings, and quick fixes

- **Container-First Architecture**:
  - Eliminates Windows compatibility issues
  - Safe automatic language server installation
  - Consistent environment across platforms

- **Zero-Config Language Support**:
  - Automatic language detection
  - Pre-installed language servers
  - Support for 10+ programming languages

## Supported Languages

- **TypeScript/JavaScript** - Full support with automatic project detection
- **Python** - Full support with virtual environment detection (venv, Poetry, Pipenv, Conda)
- Go (configuration available)
- Rust (configuration available)
- Java (configuration available)
- C/C++ (configuration available)
- Ruby (configuration available)
- PHP (configuration available)
- And more...

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