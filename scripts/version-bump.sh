#!/bin/bash

# version-bump.sh - 版本号管理脚本
# 用法:
#   ./scripts/version-bump.sh patch   # 自动递增小版本 (1.0.0 -> 1.0.1)
#   ./scripts/version-bump.sh minor   # 手动递增中间版本 (1.0.1 -> 1.1.0)
#   ./scripts/version-bump.sh major   # 手动递增大版本 (1.1.0 -> 2.0.0)

set -e

PLUGIN_JSON=".claude-plugin/plugin.json"
PACKAGE_JSON="package.json"
MARKETPLACE_JSON=".claude-plugin/marketplace.json"

# 读取当前版本
get_current_version() {
  grep -o '"version": *"[^"]*"' "$PLUGIN_JSON" | sed 's/"version": *"\([^"]*\)"/\1/'
}

# 解析版本号
parse_version() {
  local version=$1
  IFS='.' read -r MAJOR MINOR PATCH <<< "$version"
  echo "$MAJOR $MINOR $PATCH"
}

# 更新版本号
update_version() {
  local new_version=$1

  # 更新所有版本文件
  # 注意: marketplace.json 有两处版本号需要更新（顶层和 plugins 数组中）
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" "$PLUGIN_JSON"
    sed -i '' "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
    sed -i '' "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/g" "$MARKETPLACE_JSON"
  else
    sed -i "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" "$PLUGIN_JSON"
    sed -i "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
    sed -i "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/g" "$MARKETPLACE_JSON"
  fi

  echo "📦 版本号已更新: $CURRENT_VERSION -> $new_version"
  echo "   - $PLUGIN_JSON"
  echo "   - $PACKAGE_JSON"
  echo "   - $MARKETPLACE_JSON"
}

# 递增版本号
bump_version() {
  local bump_type=$1
  local current_version
  current_version=$(get_current_version)

  read -r MAJOR MINOR PATCH <<< "$(parse_version "$current_version")"

  case "$bump_type" in
    patch)
      PATCH=$((PATCH + 1))
      ;;
    minor)
      MINOR=$((MINOR + 1))
      PATCH=0
      ;;
    major)
      MAJOR=$((MAJOR + 1))
      MINOR=0
      PATCH=0
      ;;
    *)
      echo "❌ 未知的版本类型: $bump_type"
      echo "用法: $0 {patch|minor|major}"
      exit 1
      ;;
  esac

  local new_version="$MAJOR.$MINOR.$PATCH"
  CURRENT_VERSION="$current_version"
  update_version "$new_version"
}

# 主逻辑
main() {
  local bump_type=${1:-patch}

  if [[ ! -f "$PLUGIN_JSON" ]]; then
    echo "❌ 找不到 $PLUGIN_JSON"
    exit 1
  fi

  local current_version
  current_version=$(get_current_version)
  echo "📌 当前版本: $current_version"

  bump_version "$bump_type"
}

main "$@"
