#!/bin/bash

# Script to run tests in Docker container

echo "🧪 Running tests in Docker container..."

docker run --rm \
  -v "$(pwd):$(pwd)" \
  -w "$(pwd)" \
  -e NODE_ENV=test \
  --entrypoint="" \
  lsmcp:test \
  bash -c "
    # Install dev dependencies needed for testing
    npm install --include=dev
    
    # Run the tests
    npm test
  "