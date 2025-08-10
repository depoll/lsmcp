# React Component Refactoring Example

## Scenario: Rename UserProfile Component

**Task**: Rename `UserProfile` to `UserProfileCard` across a React TypeScript application, update all imports, and fix any TypeScript errors.

## Without MCP-LSP (15 steps, ~30K tokens)

### Step-by-Step Process:
```bash
# 1. Search for all occurrences
grep -r "UserProfile" --include="*.tsx" --include="*.ts"
# Output: 23 files found

# 2. Read each file to understand usage
cat src/components/UserProfile.tsx  # 500 tokens
cat src/pages/Dashboard.tsx         # 800 tokens
cat src/pages/Settings.tsx          # 600 tokens
# ... 20 more files

# 3. Manually update component file
# Edit src/components/UserProfile.tsx

# 4. Search for imports
grep -r "import.*UserProfile" --include="*.tsx" --include="*.ts"

# 5. Update each import manually
# Edit 12 different files

# 6. Search for JSX usage
grep -r "<UserProfile" --include="*.tsx"

# 7. Update all JSX references
# Edit 8 different files

# 8. Search for type references
grep -r "UserProfile" --include="*.d.ts"

# 9. Update type definitions
# Edit 3 type definition files

# 10. Run TypeScript compiler
npx tsc --noEmit

# 11. Parse error output
# 5 type errors found

# 12-15. Fix each error manually
```

**Total Operations**: 15 filesystem operations + multiple edits
**Total Context Used**: ~30,000 tokens
**Error-Prone Areas**: Missing references, inconsistent updates, type mismatches

## With MCP-LSP (3 steps, ~3K tokens)

### Step-by-Step Process:
```typescript
// 1. Find the component symbol
await findSymbols({ 
  query: "UserProfile", 
  kind: "class",
  scope: "workspace"
});
// Returns: UserProfile class at src/components/UserProfile.tsx:12

// 2. Find all references to the component
await findUsages({
  uri: "file:///src/components/UserProfile.tsx",
  position: { line: 12, character: 15 },
  type: "references",
  includeDeclaration: true,
  maxResults: 500,
  maxDepth: 3
});
// Returns: All 23 files with references to UserProfile

// 3. Check for any errors after manual renaming
await getDiagnostics({ 
  severity: "error" 
});
// Returns: TypeScript errors to help guide the refactoring
```

**Note**: While the applyEdit tool has been removed, the remaining tools still provide significant value:
- `findSymbols` quickly locates the component
- `findUsages` identifies all references accurately
- `getDiagnostics` helps verify the refactoring is correct

**Total Operations**: 3 LSP operations + manual editing
**Total Context Used**: ~3,000 tokens for discovery
**Benefits**: 
- Guaranteed consistency across all references
- Automatic import updates
- Type-safe refactoring
- No missed references

## Efficiency Comparison

| Metric | Without LSP | With LSP | Improvement |
|--------|------------|----------|-------------|
| Operations | 15 | 3 (+ manual edit) | **80% fewer searches** |
| Context (tokens) | ~30,000 | ~3,000 | **90% less** |
| Time estimate | 5-10 min | 2-3 min | **50% faster** |
| Error risk | High | Medium | **Semantic search accuracy** |

## Key Advantages

1. **Semantic Understanding**: LSP knows the difference between a variable named `UserProfile` and the component class
2. **Accurate Reference Finding**: LSP finds all usages, including dynamic imports
3. **Type Safety Verification**: TypeScript language server helps verify compatibility through diagnostics
4. **No Missed References**: Semantic search is more accurate than text-based grep

## Real Claude Code Conversation

### Without MCP-LSP:
```
User: "Rename the UserProfile component to UserProfileCard"
Claude: I'll help you rename that component. Let me search for all occurrences first...
[15+ operations later...]
Claude: I've updated the component in 23 files. Please run your tests to ensure everything works.
```

### With MCP-LSP:
```
User: "Rename the UserProfile component to UserProfileCard"
Claude: I'll find all references to that component using semantic search...
[3 LSP operations later...]
Claude: I found all 23 files that reference UserProfile. I can now help you rename them accurately with the list of exact locations.
```