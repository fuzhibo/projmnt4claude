#!/bin/bash

# sync-testmarketplace.sh - 同步插件到测试 marketplace
# 用法:
#   ./scripts/sync-testmarketplace.sh        # 自动递增小版本
#   ./scripts/sync-testmarketplace.sh minor  # 递增中间版本
#   ./scripts/sync-testmarketplace.sh major  # 递增大版本

set -e

PLUGIN_NAME="projmnt4claude"
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces"
PLUGIN_DIR="$MARKETPLACE_DIR/plugins/$PLUGIN_NAME"
VERSION_TYPE=${1:-patch}  # 默认递增小版本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📌 版本管理..."
cd "$PROJECT_ROOT"
bash scripts/version-bump.sh "$VERSION_TYPE"

echo "🔨 构建项目..."
bun run build

echo "📦 同步到测试 marketplace..."

# 创建目录结构
mkdir -p "$PLUGIN_DIR/skills/$PLUGIN_NAME/dist"
mkdir -p "$PLUGIN_DIR/commands"
mkdir -p "$PLUGIN_DIR/.claude-plugin"

# 复制文件
cp dist/$PLUGIN_NAME.js "$PLUGIN_DIR/skills/$PLUGIN_NAME/dist/"
cp -r commands/* "$PLUGIN_DIR/commands/"
cp skills/$PLUGIN_NAME/SKILL.md "$PLUGIN_DIR/skills/$PLUGIN_NAME/"
cp README.md "$PLUGIN_DIR/"
cp .claude-plugin/plugin.json "$PLUGIN_DIR/.claude-plugin/"

echo "✅ 已同步到 $PLUGIN_DIR"
echo ""
echo "🎉 同步完成！"
echo "💡 安装命令: /plugin install $PLUGIN_NAME"
