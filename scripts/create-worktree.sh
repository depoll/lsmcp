#!/bin/bash

# Script to create a git worktree and copy local config files

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Check if branch name is provided
if [ $# -eq 0 ]; then
    print_error "Please provide a branch name"
    echo "Usage: $0 <branch-name> [worktree-name]"
    echo "  branch-name: The git branch to create worktree for"
    echo "  worktree-name: Optional custom name for the worktree directory (defaults to branch name)"
    exit 1
fi

BRANCH_NAME="$1"
WORKTREE_NAME="${2:-$BRANCH_NAME}"  # Use provided name or default to branch name

# Get the repository root
REPO_ROOT="$(git rev-parse --show-toplevel)"
if [ $? -ne 0 ]; then
    print_error "Not in a git repository"
    exit 1
fi

# Define worktree base directory
WORKTREE_BASE="${REPO_ROOT}/../lsmcp-worktrees"
WORKTREE_PATH="${WORKTREE_BASE}/${WORKTREE_NAME}"

# Create worktree base directory if it doesn't exist
if [ ! -d "$WORKTREE_BASE" ]; then
    print_info "Creating worktree base directory: $WORKTREE_BASE"
    mkdir -p "$WORKTREE_BASE"
fi

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
    print_info "Worktree already exists at: $WORKTREE_PATH"
    
    # Open in VS Code if available
    if command -v code &> /dev/null; then
        print_info "Opening existing worktree in VS Code..."
        code "$WORKTREE_PATH"
        print_success "VS Code opened"
    else
        echo "To switch to the worktree:"
        echo "  cd $WORKTREE_PATH"
    fi
    exit 0
fi

# Check if branch exists (local or remote)
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    # Local branch exists
    print_info "Creating worktree for existing local branch: $BRANCH_NAME"
    git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
    # Remote branch exists
    print_info "Creating worktree for remote branch: origin/$BRANCH_NAME"
    git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
else
    # Create new branch based on current branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    print_info "Creating worktree with new branch: $BRANCH_NAME (based on current branch: $CURRENT_BRANCH)"
    git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$CURRENT_BRANCH"
fi

if [ $? -ne 0 ]; then
    print_error "Failed to create worktree"
    exit 1
fi

print_success "Worktree created at: $WORKTREE_PATH"

# Copy local config files
print_info "Copying local configuration files..."

# Find and copy all *.local.* files
LOCAL_FILES=$(find "$REPO_ROOT" -maxdepth 2 -name "*.local.*" -type f 2>/dev/null)

if [ -z "$LOCAL_FILES" ]; then
    print_info "No local config files (*.local.*) found to copy"
else
    for file in $LOCAL_FILES; do
        filename=$(basename "$file")
        dest_file="$WORKTREE_PATH/$filename"
        
        # Get relative path from repo root (portable method)
        # Remove the repo root path from the file path
        rel_path="${file#$REPO_ROOT/}"
        dest_dir=$(dirname "$WORKTREE_PATH/$rel_path")
        
        # Create destination directory if needed
        mkdir -p "$dest_dir"
        
        # Copy the file
        cp "$file" "$WORKTREE_PATH/$rel_path"
        print_success "Copied: $rel_path"
    done
fi

# Also copy .env.local if it exists
if [ -f "$REPO_ROOT/.env.local" ]; then
    cp "$REPO_ROOT/.env.local" "$WORKTREE_PATH/.env.local"
    print_success "Copied: .env.local"
fi

# Install dependencies if package.json exists
if [ -f "$WORKTREE_PATH/package.json" ]; then
    print_info "Installing npm dependencies..."
    cd "$WORKTREE_PATH"
    npm install
    print_success "Dependencies installed"
fi

print_success "Worktree setup complete!"

# Open in VS Code if available
if command -v code &> /dev/null; then
    print_info "Opening worktree in VS Code..."
    code "$WORKTREE_PATH"
    print_success "VS Code opened"
else
    echo ""
    echo "To switch to the new worktree:"
    echo "  cd $WORKTREE_PATH"
fi

echo ""
echo "To list all worktrees:"
echo "  git worktree list"
echo ""
echo "To remove this worktree later:"
echo "  git worktree remove $WORKTREE_PATH"