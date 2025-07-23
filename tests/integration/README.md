# Integration Tests

This directory contains integration tests that work with real language servers.

## Prerequisites

To run integration tests, you need language servers installed:

### TypeScript/JavaScript
```bash
npm install -g typescript-language-server typescript
```

### Python
```bash
pip install python-lsp-server
```

## Running Tests

Integration tests are skipped if the required language servers are not installed.

```bash
npm run test:integration
```

## Writing Integration Tests

Integration tests should:
1. Check if the required language server is available
2. Skip gracefully if not installed
3. Test real communication with the language server
4. Clean up all resources after testing