#!/bin/bash

# Script to check version consistency across the monorepo
# Identifies packages that should use workspace:* instead of explicit versions

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

echo "================================================"
echo "Checking Version Consistency"
echo "================================================"
echo ""

# Common dependencies that should be managed at workspace root
COMMON_DEPS=(
  "@ai-pipestream/grpc-stubs"
  "@bufbuild/protobuf"
  "@connectrpc/connect"
  "@connectrpc/connect-web"
  "@connectrpc/connect-node"
  "vue"
  "@jsonforms/core"
  "@jsonforms/vue"
  "@jsonforms/vue-vuetify"
  "vuetify"
)

echo "Checking these common dependencies:"
for dep in "${COMMON_DEPS[@]}"; do
  echo "  - $dep"
done
echo ""

# Find all package.json files in packages/* (published workspace packages)
PACKAGE_FILES=$(find "$PROJECT_ROOT/packages" -name "package.json" -not -path "*/node_modules/*" -not -path "*/dist/*")

echo "Checking workspace packages for explicit versions that should use workspace:*"
echo ""

ISSUES_FOUND=false

for file in $PACKAGE_FILES; do
  RELATIVE_PATH=$(echo "$file" | sed 's|'"$PROJECT_ROOT"'/||g')

  for dep in "${COMMON_DEPS[@]}"; do
    # Check if this package.json has an explicit version (not workspace:*)
    if grep -q "\"$dep\": \"[0-9^~]" "$file" 2>/dev/null; then
      VERSION=$(grep "\"$dep\":" "$file" | sed 's/.*": "//;s/".*//')
      echo "⚠️  $RELATIVE_PATH"
      echo "   $dep: $VERSION"
      echo "   → Should use: workspace:*"
      echo ""
      ISSUES_FOUND=true
    fi
  done
done

if [ "$ISSUES_FOUND" = false ]; then
  echo "✅ All workspace packages correctly use workspace:* for common dependencies"
  echo ""
fi

# Check for version mismatches in apps
echo "Checking app versions (these should match explicitly):"
echo ""

APP_FILES=(
  "$PROJECT_ROOT/package.json"
  "$PROJECT_ROOT/apps/platform-shell/package.json"
  "$PROJECT_ROOT/apps/platform-shell/ui/package.json"
)

for dep in "${COMMON_DEPS[@]}"; do
  VERSIONS=()

  for file in "${APP_FILES[@]}"; do
    if [ -f "$file" ]; then
      VERSION=$(grep "\"$dep\":" "$file" 2>/dev/null | sed 's/.*": "//;s/".*//' || echo "")
      if [ ! -z "$VERSION" ] && [ "$VERSION" != "workspace:*" ]; then
        VERSIONS+=("$VERSION")
      fi
    fi
  done

  # Check if all versions are the same
  if [ ${#VERSIONS[@]} -gt 0 ]; then
    UNIQUE_VERSIONS=$(printf '%s\n' "${VERSIONS[@]}" | sort -u)
    COUNT=$(echo "$UNIQUE_VERSIONS" | wc -l)

    if [ $COUNT -gt 1 ]; then
      echo "❌ $dep has version mismatch:"
      echo "$UNIQUE_VERSIONS" | sed 's/^/   - /'
      echo ""
    fi
  fi
done

echo "================================================"
echo "Summary"
echo "================================================"
echo ""
echo "Recommendations:"
echo "  1. Workspace packages (packages/*) should use workspace:*"
echo "  2. Apps should have explicit versions that match root"
echo "  3. Use sync-grpc-stubs-version.sh to update all apps at once"
echo ""
