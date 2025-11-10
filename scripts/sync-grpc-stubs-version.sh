#!/bin/bash

# Script to sync @ai-pipestream/grpc-stubs version in pnpm catalog
# Usage: ./scripts/sync-grpc-stubs-version.sh 0.1.6-alpha.20251110123501

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.1.6-alpha.20251110123501"
  exit 1
fi

NEW_VERSION="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
WORKSPACE_FILE="$PROJECT_ROOT/pnpm-workspace.yaml"

echo "================================================"
echo "Syncing @ai-pipestream/grpc-stubs version"
echo "================================================"
echo ""
echo "New version: $NEW_VERSION"
echo ""

# Update the catalog in pnpm-workspace.yaml
echo "Updating pnpm-workspace.yaml catalog..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s|'@ai-pipestream/grpc-stubs': .*|'@ai-pipestream/grpc-stubs': $NEW_VERSION|g" "$WORKSPACE_FILE"
else
  sed -i "s|'@ai-pipestream/grpc-stubs': .*|'@ai-pipestream/grpc-stubs': $NEW_VERSION|g" "$WORKSPACE_FILE"
fi

echo "✅ Updated pnpm-workspace.yaml catalog"
echo ""

echo "================================================"
echo "✨ Version sync complete!"
echo "================================================"
echo ""
echo "The catalog now has: @ai-pipestream/grpc-stubs: $NEW_VERSION"
echo "All packages using 'catalog:' will automatically use this version."
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff pnpm-workspace.yaml"
echo "  2. Install dependencies: pnpm install"
echo "  3. Clear caches: ./scripts/nuclear-clean.sh"
echo ""
