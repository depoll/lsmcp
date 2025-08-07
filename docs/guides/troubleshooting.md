# Troubleshooting Guide

## Common Issues and Solutions

### Installation Issues

#### npm install fails
**Symptom**: `npm install -g @mcp/lsp-server` fails with permission errors

**Solutions**:
1. Use npm with proper permissions:
   ```bash
   sudo npm install -g @mcp/lsp-server
   ```

2. Configure npm to use a different directory:
   ```bash
   npm config set prefix ~/.npm-global
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
   source ~/.bashrc
   npm install -g @mcp/lsp-server
   ```

3. Use a Node version manager (recommended):
   ```bash
   # Install nvm
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 20
   npm install -g @mcp/lsp-server
   ```

### Language Server Issues

#### TypeScript language server won't start
**Symptom**: "Failed to connect to TypeScript language server"

**Solutions**:
1. Check if typescript-language-server is installed:
   ```bash
   npm list -g typescript-language-server
   ```

2. Install manually if missing:
   ```bash
   npm install -g typescript typescript-language-server
   ```

3. Verify Node.js version (requires v18+):
   ```bash
   node --version
   ```

4. Check server logs:
   ```bash
   cat ~/.mcp-lsp/logs/typescript-*.log
   ```

5. Clear cache and restart:
   ```bash
   rm -rf ~/.mcp-lsp/cache
   ```

#### Python language server not found
**Symptom**: "Python language server (pylsp) not available"

**Solutions**:
1. Install Python LSP server:
   ```bash
   pip install python-lsp-server[all]
   ```

2. For virtual environments:
   ```bash
   # Activate your venv first
   source venv/bin/activate
   pip install python-lsp-server[all]
   ```

3. Verify installation:
   ```bash
   pylsp --version
   ```

4. Configure path in `.mcp-lsp.json`:
   ```json
   {
     "languages": {
       "python": {
         "command": "/path/to/venv/bin/pylsp"
       }
     }
   }
   ```

### Performance Issues

#### Operations taking >1 second
**Symptom**: LSP operations are slow

**Solutions**:
1. Enable caching:
   ```json
   {
     "performance": {
       "cache": {
         "enabled": true,
         "ttl": 300000
       }
     }
   }
   ```

2. Reduce result limits:
   ```json
   {
     "performance": {
       "maxResults": 100  // Reduce from default
     }
   }
   ```

3. Check if indexing is in progress:
   ```bash
   # Look for indexing messages
   tail -f ~/.mcp-lsp/logs/lsp-server.log
   ```

4. Pre-index large projects:
   ```bash
   mcp-lsp-server --index-only
   ```

#### High memory usage
**Symptom**: Server using >1GB RAM

**Solutions**:
1. Limit cache size:
   ```json
   {
     "performance": {
       "cache": {
         "maxMemory": 52428800  // 50MB limit
       }
     }
   }
   ```

2. Disable unused languages:
   ```json
   {
     "languages": {
       "rust": { "enabled": false },
       "java": { "enabled": false }
     }
   }
   ```

3. Use connection pooling limits:
   ```json
   {
     "performance": {
       "maxConnections": 2  // Limit concurrent servers
     }
   }
   ```

### Connection Issues

#### MCP client can't connect to LSP server
**Symptom**: "Failed to connect to MCP server"

**Solutions**:
1. Check if server is running:
   ```bash
   ps aux | grep mcp-lsp-server
   ```

2. Verify MCP configuration:
   ```bash
   cat ~/.config/mcp/settings.json
   ```

3. Test server directly:
   ```bash
   mcp-lsp-server --test
   ```

4. Check port availability:
   ```bash
   lsof -i :3000  # Default port
   ```

5. Enable debug logging:
   ```json
   {
     "mcpServers": {
       "lsp": {
         "command": "mcp-lsp-server",
         "args": ["--log-level", "debug"]
       }
     }
   }
   ```

### Feature-Specific Issues

#### Rename refactoring not working
**Symptom**: "Cannot rename symbol" error

**Solutions**:
1. Ensure file is saved before renaming
2. Check if symbol is read-only or from external library
3. Verify language server supports rename:
   ```bash
   mcp-lsp-server --capabilities
   ```

#### Code completions not appearing
**Symptom**: No suggestions from getCodeIntelligence

**Solutions**:
1. Wait for indexing to complete (first run)
2. Check trigger characters in request:
   ```typescript
   {
     completionContext: {
       triggerCharacter: ".",  // Required for member access
       triggerKind: 2
     }
   }
   ```
3. Increase completion limit:
   ```json
   {
     "performance": {
       "maxCompletions": 200
     }
   }
   ```

#### Find references returns empty
**Symptom**: findUsages returns no results

**Solutions**:
1. Ensure correct position (must be on symbol):
   ```typescript
   // Correct: position on function name
   { line: 10, character: 15 }  // On 'f' of 'function'
   
   // Incorrect: position on whitespace
   { line: 10, character: 0 }   // Before function
   ```

2. Check if project is properly configured:
   - TypeScript: `tsconfig.json` present
   - Python: `__init__.py` files in packages

3. Try with includeDeclaration:
   ```typescript
   {
     includeDeclaration: true  // Include definition
   }
   ```

### Error Messages

#### "Language server crashed"
**Cause**: Server process terminated unexpectedly

**Fix**:
1. Check crash logs:
   ```bash
   tail -100 ~/.mcp-lsp/logs/crash-*.log
   ```
2. Increase memory limit:
   ```bash
   export NODE_OPTIONS="--max-old-space-size=4096"
   ```
3. Report issue with crash log

#### "Request timeout"
**Cause**: Operation taking too long

**Fix**:
1. Increase timeout:
   ```json
   {
     "performance": {
       "requestTimeout": 10000  // 10 seconds
     }
   }
   ```
2. Reduce operation scope (smaller maxResults)

#### "Unsupported language"
**Cause**: Language server not configured

**Fix**:
1. Check supported languages list
2. Install appropriate language server
3. Add configuration for custom language:
   ```json
   {
     "languages": {
       "custom": {
         "command": "custom-lsp",
         "args": ["--stdio"]
       }
     }
   }
   ```

### Debugging Tips

#### Enable verbose logging
```bash
# Set environment variable
export MCP_LSP_DEBUG=true

# Or in configuration
{
  "mcpServers": {
    "lsp": {
      "env": {
        "MCP_LSP_DEBUG": "true"
      }
    }
  }
}
```

#### Check server health
```bash
# Health check endpoint
curl http://localhost:3000/health

# Server status
mcp-lsp-server --status
```

#### View real-time logs
```bash
# Follow server logs
tail -f ~/.mcp-lsp/logs/lsp-server.log

# Follow specific language server
tail -f ~/.mcp-lsp/logs/typescript-*.log
```

#### Test individual operations
```bash
# Test tool directly
mcp-lsp-server --test-tool navigate --file ./src/index.ts --line 10 --char 15
```

### Platform-Specific Issues

#### Windows Path Issues
**Symptom**: "Invalid file URI" on Windows

**Fix**:
- Use forward slashes: `file:///C:/Users/...`
- Or use WSL for consistent paths

#### macOS Security Warnings
**Symptom**: "Developer cannot be verified"

**Fix**:
```bash
# Allow specific binary
xattr -d com.apple.quarantine /usr/local/bin/mcp-lsp-server
```

#### Linux Permission Denied
**Symptom**: Cannot create log directory

**Fix**:
```bash
# Fix permissions
mkdir -p ~/.mcp-lsp
chmod 755 ~/.mcp-lsp
```

## Getting Help

If these solutions don't resolve your issue:

1. **Check Logs**: Always include relevant log files
2. **GitHub Issues**: [Report bugs](https://github.com/depoll/lsmcp/issues)
3. **Debug Info**: Run `mcp-lsp-server --debug-info` and include output
4. **Minimal Reproduction**: Provide smallest example that shows the problem

### Information to Include in Bug Reports

```bash
# Collect debug information
mcp-lsp-server --debug-info > debug.txt

# Include:
# - Node.js version
# - OS and version
# - MCP client version
# - Language server versions
# - Error messages
# - Relevant configuration
# - Steps to reproduce
```