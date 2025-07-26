# Setup Instructions

## Quick Start

To resolve current dependency issues, run:

```bash
npm install
```

This will install all required dependencies including:
- `eslint` and `prettier` for linting/formatting
- `@types/node` and `@types/jest` for TypeScript definitions
- `zod` for schema validation (used throughout the tools)

## Development Commands

After installation, these commands should work:

```bash
npm run lint        # Run ESLint
npm run format      # Run Prettier  
npm run type-check  # Run TypeScript compiler
npm run test        # Run all tests
npm run build       # Build for production
```

## Dependencies Fixed

- ✅ Added missing `zod` dependency (used in all tools)
- ✅ Moved `@types/node` to devDependencies 
- ✅ Removed explicit types configuration from tsconfig.json to avoid errors when packages aren't installed
- ✅ All required dev tools (eslint, prettier) are properly configured

## Notes

The current errors are due to missing `node_modules` directory. Once `npm install` is run, all tooling should work correctly.