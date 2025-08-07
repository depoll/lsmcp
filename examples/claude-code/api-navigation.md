# API Endpoint Navigation Example

## Scenario: Trace API Endpoint Flow

**Task**: Understand the complete flow of `POST /api/users` from route definition to database operations in an Express/TypeScript application.

## Without MCP-LSP (~20K tokens)

### Step-by-Step Process:
```bash
# 1. Find route definition
grep -r "POST.*\/api\/users" --include="*.ts"
# Found in: src/routes/users.ts

# 2. Read route file
cat src/routes/users.ts  # 800 tokens

# 3. Find controller reference
grep -r "createUser" --include="*.ts"
# Found in: src/controllers/userController.ts

# 4. Read controller
cat src/controllers/userController.ts  # 1200 tokens

# 5. Find service references
grep -r "UserService" --include="*.ts"
# Found in multiple files

# 6. Read service implementation
cat src/services/userService.ts  # 1500 tokens

# 7. Find validation middleware
grep -r "validateUser" --include="*.ts"

# 8. Read validation logic
cat src/middleware/validation.ts  # 600 tokens

# 9. Find repository/database calls
grep -r "UserRepository\|User\.create" --include="*.ts"

# 10. Read repository implementation
cat src/repositories/userRepository.ts  # 1000 tokens

# 11. Find model definition
grep -r "class User\|interface User" --include="*.ts"

# 12. Read model
cat src/models/User.ts  # 400 tokens

# 13. Find related utilities
grep -r "hashPassword\|sendWelcomeEmail" --include="*.ts"

# 14. Read utility functions
cat src/utils/auth.ts  # 300 tokens
cat src/utils/email.ts  # 500 tokens

# 15. Try to understand error handling
grep -r "catch.*createUser\|throw" src/
# Multiple files to check
```

**Issues**:
- Manual correlation of function calls
- May miss dynamically imported modules
- Hard to understand execution order
- No visibility into middleware chain
- Difficult to trace async operations

**Total Context**: ~20,000 tokens across 15+ files

## With MCP-LSP (~3K tokens)

### Step-by-Step Process:
```typescript
// 1. Find the route handler
await findSymbols({
  query: "/api/users",
  scope: "workspace"
});
// Returns: Route definition at src/routes/users.ts:45

// 2. Navigate to the handler implementation
await navigate({
  uri: "file:///src/routes/users.ts",
  position: { line: 45, character: 30 },
  target: "definition"
});
// Returns: createUser at src/controllers/userController.ts:23

// 3. Get call hierarchy for complete flow
await findUsages({
  uri: "file:///src/controllers/userController.ts",
  position: { line: 23, character: 15 },
  type: "callHierarchy",
  direction: "outgoing",
  maxDepth: 5
});
/* Returns complete call tree:
   createUser (controller)
   ├── validateUserInput (validation)
   ├── UserService.create (service)
   │   ├── hashPassword (auth util)
   │   ├── UserRepository.save (repository)
   │   │   └── User.create (Sequelize model)
   │   └── EmailService.sendWelcome (email)
   └── ResponseFormatter.success (response)
*/

// 4. Get type information for request/response
await getCodeIntelligence({
  uri: "file:///src/controllers/userController.ts",
  position: { line: 23, character: 40 },
  type: "hover"
});
/* Returns:
   Request body: CreateUserDto {
     email: string;
     password: string;
     firstName: string;
     lastName: string;
   }
   Response: UserResponse {
     id: string;
     email: string;
     createdAt: Date;
   }
*/
```

**Total Context**: ~3,000 tokens with complete understanding

## Efficiency Comparison

| Metric | Without LSP | With LSP | Improvement |
|--------|------------|----------|-------------|
| Operations | 15+ | 4 | **73% fewer** |
| Context (tokens) | ~20,000 | ~3,000 | **85% less** |
| Completeness | Partial | Complete | **Full call tree** |
| Accuracy | Manual correlation | Semantic | **100% accurate** |

## Visual Call Flow (LSP Generated)

```
POST /api/users
    │
    ├─→ validateAuth (middleware)
    │   └─→ JWT.verify()
    │
    ├─→ validateUserInput (middleware)
    │   ├─→ Joi.validate()
    │   └─→ checkEmailUnique()
    │
    └─→ createUser (controller)
        ├─→ UserService.create()
        │   ├─→ hashPassword()
        │   ├─→ UserRepository.save()
        │   │   ├─→ User.create()
        │   │   └─→ Database.transaction()
        │   │
        │   └─→ EmailService.sendWelcome()
        │       └─→ SendGrid.send()
        │
        └─→ ResponseFormatter.success()
```

## Key Advantages

1. **Complete Call Graph**: See entire execution flow in one operation
2. **Middleware Chain**: Understand request processing pipeline
3. **Type Information**: Know exact request/response shapes
4. **Async Flow**: Track promises and async operations
5. **Error Paths**: See error handling and catch blocks
6. **No Manual Correlation**: LSP understands the connections

## Real Claude Code Conversation

### Without MCP-LSP:
```
User: "Show me how POST /api/users works"
Claude: Let me trace through the codebase to understand the flow...
[Multiple searches and file reads...]
Claude: Based on what I found, it appears the flow goes through 
validation, then a controller, and saves to database, but I may 
have missed some middleware or utility functions.
```

### With MCP-LSP:
```
User: "Show me how POST /api/users works"
Claude: I'll trace the complete endpoint flow using code intelligence...
[4 LSP operations...]
Claude: Here's the complete flow: The request goes through JWT auth,
input validation with Joi, then createUser which hashes the password,
saves via Sequelize, sends a welcome email, and returns the formatted
response. Would you like me to explain any specific part?
```

## Advanced Capabilities

### Finding All API Endpoints
```typescript
await findSymbols({
  query: "router.(get|post|put|delete)",
  scope: "workspace"
});
// Returns all route definitions across the application
```

### Understanding Middleware Order
```typescript
await findUsages({
  uri: "file:///src/app.ts",
  position: { line: 20, character: 10 }, // app.use position
  type: "references"
});
// Shows all middleware registration in order
```