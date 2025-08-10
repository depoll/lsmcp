# TypeScript Type Error Resolution Example

## Scenario: Fix Complex Type Errors After Library Update

**Task**: After updating a library, multiple TypeScript errors appear across the codebase. Fix all type compatibility issues.

## Without MCP-LSP (~25K tokens)

### Step-by-Step Process:
```bash
# 1. Run TypeScript compiler
npx tsc --noEmit
# Output: 47 errors across 23 files

# 2. Parse error output manually
# Error: src/components/DataTable.tsx(45,12): error TS2339: Property 'onSort' does not exist on type 'TableProps'.
# Error: src/services/api.ts(78,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
# ... 45 more errors

# 3. Read first error file
cat src/components/DataTable.tsx  # 1200 tokens

# 4. Find type definition
grep -r "interface TableProps" --include="*.ts" --include="*.d.ts"
cat node_modules/@types/table/index.d.ts  # 800 tokens

# 5. Read component usage
grep -r "DataTable" --include="*.tsx"
# Found in 8 files

# 6. Fix first error manually
# Edit src/components/DataTable.tsx

# 7. Re-run compiler to check
npx tsc --noEmit
# Still 46 errors

# 8-15. Repeat for each unique error type
# Read file → Find type → Understand usage → Apply fix
# Each iteration: ~500-1000 tokens

# 16. Handle cascading errors
# Some fixes create new errors

# 17. Search for deprecated API usage
grep -r "deprecated" node_modules/@types/

# 18. Update imports
# Manual process for each file

# Total iterations: 20-30 to fix all errors
```

**Issues**:
- Manual correlation of errors to fixes
- No understanding of error relationships
- Cascading errors hard to predict
- Time-consuming iteration cycles
- May introduce new errors while fixing

**Total Context**: ~25,000 tokens across multiple iterations

## With MCP-LSP (~4K tokens)

### Step-by-Step Process:
```typescript
// 1. Get all diagnostics with severity
await getDiagnostics({
  severity: "error",
  includeRelated: true
});
/* Returns grouped errors:
   - 12 errors: 'onSort' missing (related to TableProps update)
   - 8 errors: Type 'string' not assignable to 'number' 
   - 15 errors: Missing imports
   - 12 errors: Deprecated API usage
*/

// 2. Get quick fixes for the most common error pattern
await getCodeIntelligence({
  uri: "file:///src/components/DataTable.tsx",
  position: { line: 45, character: 12 },
  type: "hover"
});
/* Returns:
   TableProps has been updated in v3.0:
   - 'onSort' renamed to 'onSortChange'
   - Signature changed from (column: string) => void 
     to (column: string, direction: 'asc' | 'desc') => void
*/

// 3. Find all files that need the rename
await findUsages({
  uri: "file:///src/types/TableProps.ts",
  position: { line: 10, character: 5 }, // position of 'onSort' property
  type: "references",
  includeDeclaration: false,
  maxResults: 500,
  maxDepth: 3
});
// Returns: All files using the old 'onSort' property

// 4. Get code actions for common fixes
await getCodeIntelligence({
  uri: "file:///src/services/api.ts",
  position: { line: 78, character: 5 },
  type: "hover"
});
/* Returns type information and suggested fixes:
   - Parameter expects 'number' but received 'string'
   - Consider using parseInt() or Number()
*/

// 5. Verify errors after manual fixes
await getDiagnostics({
  severity: "error"
});
// Returns: Updated error count to track progress
```

**Total Context**: ~4,000 tokens for analysis and guidance

## Efficiency Comparison

| Metric | Without LSP | With LSP | Improvement |
|--------|------------|----------|-------------|
| Operations | 30+ | 5 | **83% fewer** |
| Context (tokens) | ~25,000 | ~4,000 | **84% less** |
| Fix accuracy | Manual/error-prone | LSP-guided | **Semantic accuracy** |
| Time estimate | 30-60 min | 10 min | **67% faster** |

## Common Type Error Patterns & LSP Solutions

### 1. Breaking API Changes
```typescript
// LSP detects pattern across files
await getDiagnostics({ 
  severity: "error",
  includeRelated: true 
});
// Groups related errors and suggests migration
```

### 2. Missing Type Imports
```typescript
// LSP identifies correct import locations
await getCodeIntelligence({
  uri: "file:///src/components/Button.tsx",
  position: { line: 10, character: 15 },
  type: "completion"
});
// Suggests: import { ButtonProps } from '@ui/types'
```

### 3. Generic Type Mismatches
```typescript
// LSP infers correct generic parameters
await getCodeIntelligence({
  type: "completion",
  completionContext: { triggerCharacter: "<" }
});
```

### 4. Union Type Narrowing
```typescript
// LSP suggests type guards
await getCodeIntelligence({
  type: "hover"
  // Shows: "Use 'if (typeof x === 'string')' to narrow type"
});
```

## Advanced Features

### Preventive Type Checking
```typescript
// Before making changes, check impact
await findUsages({
  uri: "file:///src/types/index.ts",
  position: { line: 10, character: 15 },
  type: "references"
});
// Shows all files that would be affected by type change
```

### Migration Assistance
```typescript
// Get migration path for breaking changes
await getCodeIntelligence({
  uri: "file:///deprecated-api-usage.ts",
  position: { line: 20, character: 10 },
  type: "hover"
});
// Returns: "@deprecated Use 'newMethod' instead. Will be removed in v4.0"
```

## Real Claude Code Conversation

### Without MCP-LSP:
```
User: "Fix the TypeScript errors after updating the table library"
Claude: I'll help you fix those errors. Let me first see what errors we have...
[Runs tsc, reads files, searches for types...]
Claude: I found 47 errors. Let me start fixing them one by one...
[30+ operations later...]
Claude: I've fixed most errors, but there might be some edge cases. 
Please run the type checker again.
```

### With MCP-LSP:
```
User: "Fix the TypeScript errors after updating the table library"
Claude: I'll analyze all TypeScript errors using code intelligence...
[5 LSP operations...]
Claude: I've identified all 47 errors and their patterns:
- 12 files need 'onSort' renamed to 'onSortChange'
- 15 files are missing imports (I have the correct paths)
- 8 type mismatches need string-to-number conversion
- 12 deprecated API calls with migration paths
I can now help you fix these systematically with the exact locations.
```

## Benefits Summary

1. **Grouped Error Analysis**: Related errors identified and fixed together
2. **Automatic Quick Fixes**: LSP provides corrections, not just error messages
3. **Import Management**: Automatic addition of missing imports with correct paths
4. **Type Inference**: LSP understands complex type relationships
5. **Migration Support**: Built-in deprecation warnings and migration paths
6. **Preventive Analysis**: Check impact before making changes