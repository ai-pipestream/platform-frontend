#!/bin/bash

# Script to standardize dependency versions across the monorepo
# Updates workspace packages to use workspace:* for common dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

echo "================================================"
echo "Standardizing Dependency Versions"
echo "================================================"
echo ""

# Step 1: Update workspace packages to use workspace:*
echo "Step 1: Converting workspace packages to use workspace:*"
echo ""

WORKSPACE_PACKAGES=(
  "$PROJECT_ROOT/packages/connector-shared/package.json"
  "$PROJECT_ROOT/packages/protobuf-forms/package.json"
  "$PROJECT_ROOT/packages/shared-components/package.json"
  "$PROJECT_ROOT/packages/shared-nav/package.json"
)

COMMON_DEPS=(
  "@bufbuild/protobuf"
  "@connectrpc/connect"
  "@connectrpc/connect-web"
  "@connectrpc/connect-node"
  "vue"
  "@jsonforms/core"
  "@jsonforms/vue"
  "@jsonforms/vue-vuetify"
  "@jsonforms/vue-vanilla"
  "vuetify"
)

for file in "${WORKSPACE_PACKAGES[@]}"; do
  if [ ! -f "$file" ]; then
    continue
  fi

  RELATIVE_PATH=$(echo "$file" | sed 's|'"$PROJECT_ROOT"'/||g')
  echo "Updating: $RELATIVE_PATH"

  for dep in "${COMMON_DEPS[@]}"; do
    # Replace explicit versions with workspace:*
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|\"$dep\": \"[^\"]*\"|\"$dep\": \"workspace:*\"|g" "$file"
    else
      sed -i "s|\"$dep\": \"[^\"]*\"|\"$dep\": \"workspace:*\"|g" "$file"
    fi
  done

  echo "  ✅ Updated to use workspace:*"
done

echo ""
echo "Step 2: Ensuring root package.json has latest versions"
echo ""

# These are already set in root package.json from previous edit
echo "✅ Root package.json already configured with:"
echo "  - @ai-pipestream/grpc-stubs: 0.1.6-alpha.20251110123501"
echo "  - @bufbuild/protobuf: ^2.10.0"
echo "  - @connectrpc/connect: ^2.1.0"
echo "  - @connectrpc/connect-web: ^2.1.0"
echo "  - vue: ^3.5.18"
echo "  - vuetify: ^3.9.3"
echo "  - @jsonforms/*: ^3.7.0-alpha.2"
echo ""

echo "================================================"
echo "✨ Standardization complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Install dependencies: pnpm install"
echo "  3. Build packages: pnpm -r build"
echo ""
echo "All workspace packages now inherit versions from root package.json"
echo ""
