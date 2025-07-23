#!/bin/bash

# Run lint and type-check, capturing output
echo "🔍 Running code quality checks..."

# Run linting
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT_CODE=$?

# Run type checking
TYPECHECK_OUTPUT=$(npm run type-check 2>&1)
TYPECHECK_EXIT_CODE=$?

npm run format

# If both pass, exit successfully
if [ $LINT_EXIT_CODE -eq 0 ] && [ $TYPECHECK_EXIT_CODE -eq 0 ]; then
    echo "✅ All checks passed!"
    exit 0
fi

# If there are errors, format them for Claude
echo "❌ Code quality issues detected:"
echo ""

if [ $LINT_EXIT_CODE -ne 0 ]; then
    echo "## Linting Errors:"
    echo "$LINT_OUTPUT" | grep -E "error|warning" | head -20
    echo ""
fi

if [ $TYPECHECK_EXIT_CODE -ne 0 ]; then
    echo "## Type Checking Errors:"
    echo "$TYPECHECK_OUTPUT" | grep -E "error|TS[0-9]+" | head -20
    echo ""
fi

echo "Please fix the above issues before continuing."
exit 2