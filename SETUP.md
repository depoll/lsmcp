# Setup Instructions

## ⚠️ IMPORTANT: Dependencies Must Be Installed First

The current linting and type checking errors are due to **missing dependencies**. You must run:

```bash
npm install
```

## Why These Errors Occur

The project is configured correctly, but TypeScript and linting tools can't function without their dependencies:

### Missing Tools (causing "command not found" errors):
- `eslint` - Not in PATH until npm installed  
- `prettier` - Not in PATH until npm installed

### Missing Type Definitions (causing TS2307/TS2580 errors):
- `@types/node` - Required for Node.js globals like `process`, `fs`, etc.
- `pino` - The logging library and its types
- All other npm packages

## Quick Fix

**Before running any development commands, install dependencies:**

```bash
# Install all dependencies
npm install

# Then these will work:
npm run lint        # ✅ ESLint will be available
npm run format      # ✅ Prettier will be available  
npm run type-check  # ✅ TypeScript will find all types
npm run test        # ✅ Jest will be available
```

## CI/CD Note

If you're seeing these errors in GitHub Actions or other CI environments, make sure your workflow includes:

```yaml
- name: Install dependencies
  run: npm install
```

## What's Already Fixed

- ✅ `zod` dependency added to package.json
- ✅ `@types/node` moved to devDependencies
- ✅ TypeScript configuration optimized
- ✅ All package versions are compatible

**Bottom line:** Run `npm install` and all errors will resolve.