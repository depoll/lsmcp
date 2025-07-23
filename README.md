# LSMCP - Language Server Protocol MCP

An experimental project for building an MCP (Model Context Protocol) for the Language Server Protocol (LSP).

## Overview

This project aims to create an MCP implementation that can communicate with LSP servers, potentially enabling AI models to access code intelligence features like auto-completion, go-to-definition, find-references, and other language-specific capabilities.

## Status

🚧 **Under Development** - This project is in the early stages of development.

## Getting Started

### Prerequisites

- Node.js 18+ (tested on 18.x, 20.x, and 22.x)
- npm or yarn

### Installation

```bash
git clone https://github.com/depoll/lsmcp.git
cd lsmcp
npm install
```

### Development

```bash
# Run in development mode with hot reloading
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

## Project Structure

```
lsmcp/
├── src/              # Source code
│   ├── server.ts     # MCP server implementation
│   ├── types/        # TypeScript type definitions
│   ├── tools/        # MCP tool implementations
│   ├── lsp/          # LSP client implementations
│   └── utils/        # Utility functions
├── tests/            # Test suites
│   ├── unit/         # Unit tests
│   ├── integration/  # Integration tests
│   └── efficiency/   # Efficiency benchmarks
└── dist/             # Built artifacts
```

## CI/CD

The project uses GitHub Actions for continuous integration with:

- Matrix testing across Node.js 18, 20, and 22
- Cross-platform testing on Ubuntu, macOS, and Windows
- Automated linting and type checking
- Test coverage reporting with >90% threshold
- Efficiency benchmark tracking on PRs

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.