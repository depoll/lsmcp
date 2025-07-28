#!/bin/bash

# Build Docker image for LSMCP
set -e

echo "Building LSMCP Docker image..."

# Build the Docker image
docker build -t lsmcp:latest .

echo "Docker image built successfully!"
echo "To run the MCP server in a container:"
echo "  docker run --rm -i -v \"\$(pwd):/workspace\" lsmcp:latest"
echo ""
echo "Or use docker-compose:"
echo "  docker-compose up"