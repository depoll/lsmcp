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

## With MCP-LSP (4 steps, ~5K tokens)

### Step-by-Step Process:
```typescript
// 1. Find the component symbol
await findSymbols({ 
  query: "UserProfile", 
  kind: "class",
  scope: "workspace"
});
// Returns: UserProfile class at src/components/UserProfile.tsx:12

// 2. Rename across entire codebase
await applyEdit({
  edit: {
    documentChanges: [{
      kind: "rename",
      oldUri: "file:///src/components/UserProfile.tsx",
      newName: "UserProfileCard",
      position: { line: 12, character: 15 }
    }]
  },
  label: "Rename UserProfile to UserProfileCard"
});
// Automatically updates: component definition, all imports, JSX usage, type references

// 3. Check for any errors
await getDiagnostics({ 
  severity: "error" 
});
// Returns: 2 related type errors

// 4. Apply quick fixes
await applyEdit({
  edit: {
    documentChanges: diagnostics.map(d => d.quickFix)
  },
  label: "Apply TypeScript quick fixes"
});
// Fixes remaining type compatibility issues
```

**Total Operations**: 4 LSP operations
**Total Context Used**: ~5,000 tokens
**Benefits**: 
- Guaranteed consistency across all references
- Automatic import updates
- Type-safe refactoring
- No missed references

## Efficiency Comparison

| Metric | Without LSP | With LSP | Improvement |
|--------|------------|----------|-------------|
| Operations | 15 | 4 | **73% fewer** |
| Context (tokens) | ~30,000 | ~5,000 | **83% less** |
| Time estimate | 5-10 min | 30 sec | **90% faster** |
| Error risk | High | Low | **Semantic accuracy** |

## Key Advantages

1. **Semantic Understanding**: LSP knows the difference between a variable named `UserProfile` and the component class
2. **Automatic Propagation**: One rename operation updates all references
3. **Type Safety**: TypeScript language server ensures type compatibility
4. **No Missed References**: LSP finds all usages, including dynamic imports
5. **Rollback Capability**: Transaction-based edits can be reverted if issues arise

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
Claude: I'll rename that component using semantic refactoring...
[4 operations later...]
Claude: Done! The component has been renamed across all 23 files with type safety guaranteed.
```