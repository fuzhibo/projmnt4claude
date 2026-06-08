#!/bin/bash
# scripts/verify-force-add-detection.sh
# 验证 pre-commit hook 能检测强制添加
#
# 注意：此测试会创建临时提交用于验证，测试完成后会回滚

# 不使用 set -e，手动处理错误
echo "=== 强制添加检测验证 ==="

# 检查 pre-commit hook 是否存在
if [ ! -f "scripts/pre-commit-hook" ]; then
    echo "❌ 错误: scripts/pre-commit-hook 不存在"
    exit 1
fi

# 保存当前 pre-commit hook
if [ -f .git/hooks/pre-commit ]; then
    cp .git/hooks/pre-commit .git/hooks/pre-commit.backup.$(date +%s)
    echo "📦 已备份现有 hook"
fi

# 安装新 hook
cp scripts/pre-commit-hook .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "✅ 已安装新的 pre-commit hook"

# 保存当前分支状态
CURRENT_BRANCH=$(git branch --show-current)
TEST_BRANCH="test-pre-commit-$(date +%s)"

# 创建测试分支
git checkout -b "$TEST_BRANCH" 2>/dev/null || true

PASS=0
FAIL=0

# 测试 1: 检测 .gitignore 文件被强制添加
echo ""
echo "📋 测试 1: .gitignore 文件强制添加检测..."
echo "test" > .env
git add -f .env 2>/dev/null || true
# 使用 git commit（不跳过 hook）来测试
OUTPUT=$(git commit -m "test" 2>&1 || true)
# 检查是否被阻止
if echo "$OUTPUT" | grep -q "检测到违规文件"; then
    echo "✅ .gitignore 强制添加检测正常"
    PASS=$((PASS + 1))
else
    echo "❌ .gitignore 强制添加检测失败"
    echo "   Hook 输出: $(echo "$OUTPUT" | grep -E '(违规|警告|忽略|检查)' | head -3)"
    FAIL=$((FAIL + 1))
fi
# 清理
git reset HEAD .env 2>/dev/null || true
rm -f .env

# 测试 2: 检测 .git/info/exclude 文件被强制添加
echo ""
echo "📋 测试 2: .git/info/exclude 文件强制添加检测..."
EXCLUDE_TEST_FILE="exclude-test-$(date +%s)"
echo "$EXCLUDE_TEST_FILE" >> .git/info/exclude
touch "$EXCLUDE_TEST_FILE"
git add -f "$EXCLUDE_TEST_FILE" 2>/dev/null || true
OUTPUT=$(git commit -m "test" 2>&1 || true)
if echo "$OUTPUT" | grep -q "检测到违规文件"; then
    echo "✅ .git/info/exclude 强制添加检测正常"
    PASS=$((PASS + 1))
else
    echo "❌ .git/info/exclude 强制添加检测失败"
    FAIL=$((FAIL + 1))
fi
# 清理
git reset HEAD "$EXCLUDE_TEST_FILE" 2>/dev/null || true
rm -f "$EXCLUDE_TEST_FILE"
sed -i '/exclude-test/d' .git/info/exclude 2>/dev/null || true

# 测试 3: 正常文件允许提交
echo ""
echo "📋 测试 3: 正常文件允许提交..."
TEST_FILE="test-normal-file-$(date +%s).txt"
echo "test" > "$TEST_FILE"
git add "$TEST_FILE" 2>/dev/null || true
if git diff --cached --name-only | grep -q "$TEST_FILE"; then
    echo "✅ 正常文件可以添加到暂存区"
    PASS=$((PASS + 1))
else
    echo "❌ 正常文件无法添加到暂存区"
    FAIL=$((FAIL + 1))
fi
# 清理（不提交，直接重置）
git reset HEAD "$TEST_FILE" 2>/dev/null || true
rm -f "$TEST_FILE"

# 测试 4: 忽略来源显示
echo ""
echo "📋 测试 4: 忽略来源显示..."
echo "test" > .env
git add -f .env 2>/dev/null || true
OUTPUT=$(git commit -m "test" 2>&1 || true)
if echo "$OUTPUT" | grep -q "忽略来源"; then
    echo "✅ 忽略来源显示正常"
    PASS=$((PASS + 1))
else
    echo "❌ 忽略来源显示失败"
    FAIL=$((FAIL + 1))
fi
# 清理
git reset HEAD .env 2>/dev/null || true
rm -f .env

# 回滚测试分支
echo ""
echo "🧹 清理测试环境..."
git checkout "$CURRENT_BRANCH" 2>/dev/null || true
git branch -D "$TEST_BRANCH" 2>/dev/null || true

# 恢复原 hook（如果存在备份）
BACKUP_FILE=$(ls -t .git/hooks/pre-commit.backup.* 2>/dev/null | head -1)
if [ -n "$BACKUP_FILE" ]; then
    mv "$BACKUP_FILE" .git/hooks/pre-commit
    echo "📦 已恢复原 hook"
fi

echo ""
echo "============================================"
echo "=== 验证结果 ==="
echo "============================================"
echo "✅ 通过: $PASS"
echo "❌ 失败: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
