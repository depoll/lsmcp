# ApplyEdit Tool Usage Examples

## Critical Concepts

### Line and Character Positioning (0-indexed)

```
File content:
Line 0: "function foo() {"     // First line is line 0
Line 1: "  return 42;"         // Second line is line 1  
Line 2: "}"                    // Third line is line 2

Character positions within line 1 ("  return 42;"):
Char 0: '  return 42;'  // Before first space
Char 2: 'return 42;'    // After two spaces
Char 8: ' 42;'          // After "return"
Char 12: ';'            // Before semicolon
Char 13: ''             // After semicolon (end of line)
```

## Common Operations

### 1. Fix a Typo (Simple Text Edit)

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [{
        "range": {
          "start": { "line": 5, "character": 10 },  // Line 6 in editor, char 11
          "end": { "line": 5, "character": 18 }      // Same line, char 19
        },
        "newText": "calculate"  // Replaces chars 10-18 with "calculate"
      }]
    }
  }
}
```

### 2. Insert a New Line Between Existing Lines

To insert after line 10 (making it the new line 11):

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [{
        "range": {
          "start": { "line": 10, "character": 999 },  // End of line 10 (use large number)
          "end": { "line": 10, "character": 999 }     // Same position (insert mode)
        },
        "newText": "\n  console.log('New line');"    // Note the \n at start
      }]
    }
  }
}
```

### 3. Add to Beginning of File

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [{
        "range": {
          "start": { "line": 0, "character": 0 },
          "end": { "line": 0, "character": 0 }
        },
        "newText": "// Copyright notice\n\n"
      }]
    }
  }
}
```

### 4. Replace an Entire Line

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [{
        "range": {
          "start": { "line": 15, "character": 0 },
          "end": { "line": 15, "character": 999 }  // Use large number for end of line
        },
        "newText": "  const newValue = 123;"
      }]
    }
  }
}
```

### 5. Delete Lines

To delete lines 5-7 (inclusive):

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [{
        "range": {
          "start": { "line": 5, "character": 0 },
          "end": { "line": 8, "character": 0 }  // Start of line AFTER last line to delete
        },
        "newText": ""  // Empty string deletes the range
      }]
    }
  }
}
```

### 6. Create File with Content

**IMPORTANT**: Use `documentChanges` for ordered operations!

```json
{
  "edit": {
    "documentChanges": [
      {
        "kind": "create",
        "uri": "file:///path/to/new-file.ts",
        "options": { "overwrite": false }
      },
      {
        "textDocument": {
          "uri": "file:///path/to/new-file.ts",
          "version": null
        },
        "edits": [{
          "range": {
            "start": { "line": 0, "character": 0 },
            "end": { "line": 0, "character": 0 }
          },
          "newText": "export const config = {\n  name: 'app'\n};"
        }]
      }
    ]
  }
}
```

### 7. Multiple Edits to Same File

Edits are applied in order specified:

```json
{
  "edit": {
    "changes": {
      "file:///path/to/file.ts": [
        {
          "range": {
            "start": { "line": 0, "character": 0 },
            "end": { "line": 0, "character": 0 }
          },
          "newText": "import { helper } from './helper';\n"
        },
        {
          "range": {
            "start": { "line": 10, "character": 15 },
            "end": { "line": 10, "character": 20 }
          },
          "newText": "helper()"
        }
      ]
    }
  }
}
```

### 8. Rename File

```json
{
  "edit": {
    "documentChanges": [
      {
        "kind": "rename",
        "oldUri": "file:///path/to/old-name.ts",
        "newUri": "file:///path/to/new-name.ts",
        "options": { "overwrite": false }
      }
    ]
  }
}
```

### 9. Delete File

```json
{
  "edit": {
    "documentChanges": [
      {
        "kind": "delete",
        "uri": "file:///path/to/file-to-delete.ts",
        "options": { "ignoreIfNotExists": true }
      }
    ]
  }
}
```

## Common Pitfalls and Solutions

### ❌ WRONG: Using 1-based line numbers
```json
{
  "range": {
    "start": { "line": 1, "character": 0 },  // WRONG: This is line 2!
    "end": { "line": 1, "character": 10 }
  }
}
```

### ✅ CORRECT: Using 0-based line numbers
```json
{
  "range": {
    "start": { "line": 0, "character": 0 },  // CORRECT: First line
    "end": { "line": 0, "character": 10 }
  }
}
```

### ❌ WRONG: Trying to edit a file that doesn't exist
```json
{
  "edit": {
    "changes": {
      "file:///new-file.ts": [{  // File doesn't exist!
        "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } },
        "newText": "content"
      }]
    }
  }
}
```

### ✅ CORRECT: Create file first, then edit
```json
{
  "edit": {
    "documentChanges": [
      { "kind": "create", "uri": "file:///new-file.ts" },
      {
        "textDocument": { "uri": "file:///new-file.ts", "version": null },
        "edits": [{
          "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } },
          "newText": "content"
        }]
      }
    ]
  }
}
```

### ❌ WRONG: Overlapping edits
```json
{
  "edit": {
    "changes": {
      "file:///file.ts": [
        { "range": { "start": { "line": 5, "character": 0 }, "end": { "line": 5, "character": 20 } }, "newText": "foo" },
        { "range": { "start": { "line": 5, "character": 10 }, "end": { "line": 5, "character": 30 } }, "newText": "bar" }
      ]
    }
  }
}
```

### ✅ CORRECT: Non-overlapping edits (applied in reverse order automatically)
```json
{
  "edit": {
    "changes": {
      "file:///file.ts": [
        { "range": { "start": { "line": 5, "character": 0 }, "end": { "line": 5, "character": 10 } }, "newText": "foo" },
        { "range": { "start": { "line": 5, "character": 20 }, "end": { "line": 5, "character": 30 } }, "newText": "bar" }
      ]
    }
  }
}
```

## Tips for AI Agents

1. **Always check if file exists** before trying to edit it
2. **Use documentChanges** when order matters (create → edit)
3. **Remember 0-indexing** for both lines and characters
4. **Count carefully** - use the Read tool to see line numbers if unsure
5. **Test with small edits first** before making large changes
6. **Review the diff output** to confirm changes were applied correctly