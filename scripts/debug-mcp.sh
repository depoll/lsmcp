#!/bin/bash

echo "🔍 Debugging MCP Server Connection..."
echo ""

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running or not accessible"
    echo "   Please start Docker Desktop or check Docker daemon"
    exit 1
fi

echo "✅ Docker is running"

# Check if the image exists
if ! docker image inspect lsmcp:latest >/dev/null 2>&1; then
    echo "❌ Docker image 'lsmcp:latest' not found"
    echo "   Run: npm run docker:build"
    exit 1
fi

echo "✅ Docker image 'lsmcp:latest' exists"

# Test MCP server startup
echo ""
echo "🧪 Testing MCP server initialization..."

# Create a temporary initialization message
INIT_MSG='{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "debug-test", "version": "1.0"}}}'

echo "Sending initialization message..."
echo "$INIT_MSG" | docker run --rm -i -v "$(pwd):$(pwd)" -w "$(pwd)" lsmcp:latest | head -20

echo ""
echo "🛠️ To test manually:"
echo "   1. Try the 'lsmcp-simple' configuration in your MCP client"
echo "   2. Or use: docker run --rm -i -v \"\$(pwd):\$(pwd)\" -w \"\$(pwd)\" lsmcp:latest"
echo ""
echo "📋 Available MCP configurations in .mcp.json:"
echo "   - lsmcp: Uses consistent paths (preferred)"
echo "   - lsmcp-simple: Uses /workspace mounting (fallback)"
echo "   - lsmcp-dev: Development mode with hot reload"