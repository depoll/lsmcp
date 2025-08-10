# Getting Started with MCP-LSP Server

Enable Claude Code and other AI agents to use Language Server Protocol for semantic code understanding. Get **50% less context usage** and **2-5x fewer operations** compared to traditional file-based approaches.

## Quick Start (5 minutes)

### 1. Installation

```bash
# Install globally
npm install -g @mcp/lsp-server

# Or install locally in your project
npm install --save-dev @mcp/lsp-server
```

### 2. Configure MCP

Add to your MCP configuration file (usually `~/.config/mcp/settings.json` or specified by your MCP client):

```json
{
  "mcpServers": {
    "lsp": {
      "command": "mcp-lsp-server",
      "args": [],
      "env": {}
    }
  }
}
```

For local installation:
```json
{
  "mcpServers": {
    "lsp": {
      "command": "npx",
      "args": ["mcp-lsp-server"],
      "env": {}
    }
  }
}
```

### 3. Verify Installation

Start your MCP client (e.g., Claude Code) and verify the LSP server is available:

```
You: "What MCP tools are available?"
Claude: I have access to the following LSP tools:
- navigate: For go-to-definition, implementation, and type navigation
- getCodeIntelligence: For hover info, signatures, and completions
- findSymbols: For searching symbols in files or workspace
- findUsages: For finding references and call hierarchies
- getDiagnostics: For errors, warnings, and quick fixes
```

### 4. First Usage

Try a simple command to test the integration:

```
You: "Find all functions in the current project"
Claude: I'll search for all functions in the workspace...
[Uses findSymbols tool]
Found 47 functions across your project:
- calculateTotal() at src/utils/math.ts:15
- validateUser() at src/auth/validation.ts:23
- handleRequest() at src/server/routes.ts:45
...
```

## Configuration Options

### Basic Configuration

```json
{
  "mcpServers": {
    "lsp": {
      "command": "mcp-lsp-server",
      "args": ["--log-level", "info"],
      "env": {
        "LSP_MAX_RESULTS": "500",
        "LSP_CACHE_ENABLED": "true"
      }
    }
  }
}
```

### Advanced Configuration

Create a `.mcp-lsp.json` file in your project root:

```json
{
  "languages": {
    "typescript": {
      "enabled": true,
      "server": "auto",
      "initializationOptions": {
        "preferences": {
          "includeCompletionsForModuleExports": true
        }
      }
    },
    "python": {
      "enabled": true,
      "server": "auto",
      "settings": {
        "python.analysis.typeCheckingMode": "strict"
      }
    }
  },
  "performance": {
    "maxResults": 1000,
    "requestTimeout": 5000,
    "cacheTTL": 300000
  },
  "features": {
    "batching": true,
    "streaming": true,
    "fallbackSuggestions": true
  }
}
```

## Supported Languages

MCP-LSP automatically detects and configures language servers for:

| Language | Auto-Install | Language Server |
|----------|--------------|-----------------|
| TypeScript/JavaScript | ✅ | typescript-language-server |
| Python | ✅ | pylsp |
| Rust | ✅ | rust-analyzer |
| Go | ✅ | gopls |
| Java | ✅ | jdtls |
| C/C++ | ✅ | clangd |
| Ruby | ✅ | solargraph |
| PHP | ✅ | intelephense |
| C# | ✅ | omnisharp |
| Swift | ✅ | sourcekit-lsp |

## Common Use Cases

### 1. Finding Definitions
```
You: "Where is the UserService class defined?"
Claude: [Uses navigate tool to find definition]
The UserService class is defined at src/services/user.service.ts:25
```

### 2. Finding All References for Refactoring
```
You: "Find all uses of the calculateTotal function"
Claude: [Uses findUsages tool to locate all references]
Found calculateTotal used in 15 files at 42 locations. 
I can help you systematically rename these references.
```

### 3. Understanding Code
```
You: "What does the processPayment function do?"
Claude: [Uses getCodeIntelligence for hover info]
The processPayment function handles payment transactions...
```

### 4. Finding Usage
```
You: "Show me all places where the auth middleware is used"
Claude: [Uses findUsages tool]
The auth middleware is used in 23 locations...
```

## Performance Tips

### 1. Use Workspace Indexing
Let the language server index your project on first start:
```bash
# Pre-index before using with AI
mcp-lsp-server --index-only
```

### 2. Configure Result Limits
Adjust based on your needs:
```json
{
  "performance": {
    "maxResults": 200  // Lower for focused searches
  }
}
```

### 3. Enable Caching
Cache frequently accessed data:
```json
{
  "performance": {
    "cache": {
      "enabled": true,
      "maxMemory": 104857600  // 100MB
    }
  }
}
```

## Troubleshooting

### Server Won't Start
- Check Node.js version: `node --version` (requires v18+)
- Verify installation: `npm list -g @mcp/lsp-server`
- Check logs: `~/.mcp-lsp/logs/`

### Language Server Missing
The server will auto-install language servers, but you can install manually:
```bash
# TypeScript
npm install -g typescript typescript-language-server

# Python
pip install python-lsp-server[all]
```

### Slow Performance
- Reduce `maxResults` in configuration
- Enable caching
- Check if language server is indexing (first run)

## Docker Usage

For consistent environment across teams:

```bash
# Using Docker
docker run -v $(pwd):/workspace mcplsp/server

# Using Docker Compose
docker-compose up mcp-lsp
```

## Integration with Claude Code

Claude Code automatically uses MCP-LSP when available. You'll notice:
- Fewer file reads
- More accurate code navigation
- Faster refactoring operations
- Better understanding of code relationships

Example conversation showing the difference:

**Without MCP-LSP:**
```
You: "Find all API endpoints"
Claude: Let me search through your files...
[Reads 20+ files]
```

**With MCP-LSP:**
```
You: "Find all API endpoints"
Claude: I'll find all API endpoints using code intelligence...
[Single findSymbols operation]
```

## Next Steps

1. **Explore Examples**: Check the `/examples` directory for detailed use cases
2. **Read API Docs**: Full API documentation at `/docs/api`
3. **Configure for Your Language**: Customize settings for your tech stack
4. **Measure Efficiency**: Compare token usage before and after

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/depoll/lsmcp/issues)
- **Documentation**: [Full Docs](https://github.com/depoll/lsmcp/docs)
- **Community**: [Discord Server](https://discord.gg/mcp-lsp)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.