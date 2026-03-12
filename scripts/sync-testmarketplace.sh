#!/bin/bash

# ============================================================================
# sync-testmarketplace.sh - 同步插件到【测试】 marketplace
# ============================================================================
#
# ⚠️  重要警告 - 请仔细阅读 ⚠️
#
# 此脚本用于同步到【测试环境】，不是生产环境！
#
# 【测试环境】(此脚本的目标)
#   路径: ~/claude-marketplace/
#   用途: 开发和验证新版本
#   安装: claude /plugins install projmnt4claude (从测试 marketplace)
#
# 【生产环境】(不要直接修改！)
#   路径: ~/.claude/plugins/marketplaces/
#   用途: Claude Code 实际使用的插件
#   安装: 用户通过 /plugins install 从远程 marketplace 安装
#
# 为什么不能直接同步到生产环境？
#   1. 会导致 installed_plugins.json 中缺少安装记录
#   2. 用户无法正常卸载或更新插件
#   3. 会报错 "Plugin is not installed"
#
# 正确的发布流程:
#   1. 开发 → bun run build
#   2. 测试 → bun run sync-testmarketplace (此脚本)
#   3. 验证 → 在测试环境中验证功能
#   4. 发布 → git push (用户通过正常流程安装)
#
# 用法:
#   ./scripts/sync-testmarketplace.sh        # 自动递增小版本 (patch)
#   ./scripts/sync-testmarketplace.sh minor  # 递增中间版本 (minor)
#   ./scripts/sync-testmarketplace.sh major  # 递增大版本 (major)
#
# ============================================================================

set -e

PLUGIN_NAME="projmnt4claude"
MARKETPLACE_DIR="$HOME/claude-marketplace"
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
