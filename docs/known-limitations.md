# Known Limitations

## TypeScript Language Server

### Workspace Symbol Search

The TypeScript language server's `workspace/symbol` request may fail with a "No Project" error in certain scenarios:

**Error Message:**
```
TypeScript Server Error: No Project.
Error: No Project.
    at Object.ThrowNoProject (/path/to/typescript/lib/typescript.js:185022:11)
```

**Cause:**
The TypeScript language server requires a properly configured project context before it can perform workspace-wide symbol searches. This is a limitation of the tsserver implementation where it needs to have:
1. A valid tsconfig.json or jsconfig.json
2. At least one file from the project to be opened and processed
3. The project to be fully initialized

**Current Workaround:**
The SymbolSearchTool attempts to mitigate this by:
1. Opening a TypeScript/JavaScript file before performing workspace searches
2. Providing fallback grep commands when the LSP request fails

**Fallback Example:**
When workspace symbol search fails, use the suggested grep command:
```bash
grep -r "YourSymbolName" --include="*.ts" --include="*.js" --include="*.py"
```

**Future Improvements:**
- Implement a project initialization phase that ensures TypeScript projects are fully loaded
- Cache project state to avoid re-initialization
- Consider using TypeScript compiler API directly for workspace operations

### Document Scope Works Correctly

Note that document-scoped symbol searches (when a specific file URI is provided) work correctly without this limitation, as the file context is explicitly provided.