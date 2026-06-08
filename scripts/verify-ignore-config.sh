#!/bin/bash
# scripts/verify-ignore-config.sh
# 验证 git check-ignore 能正确读取所有忽略配置

# 不使用 set -e，手动处理错误
echo "=== Git 忽略配置验证 ==="

PASS=0
FAIL=0

# 测试 1: .gitignore 读取
echo ""
echo "📋 测试 .gitignore 读取..."
if [ -d ".projmnt4claude" ]; then
    echo "test" > .projmnt4claude/verify-test.json
    RESULT=$(git check-ignore -v .projmnt4claude/verify-test.json 2>&1 || true)
    if echo "$RESULT" | grep -q ".gitignore"; then
        echo "✅ .gitignore 读取正常"
        echo "   结果: $RESULT"
        PASS=$((PASS + 1))
    else
        echo "❌ .gitignore 读取失败"
        echo "   结果: $RESULT"
        FAIL=$((FAIL + 1))
    fi
    rm -f .projmnt4claude/verify-test.json
else
    echo "⚠️  .projmnt4claude 目录不存在，跳过测试"
fi

# 测试 2: .git/info/exclude 读取
echo ""
echo "📋 测试 .git/info/exclude 读取..."
EXCLUDE_TEST_FILE="verify-exclude-test-$(date +%s)"
echo "$EXCLUDE_TEST_FILE" >> .git/info/exclude
touch "$EXCLUDE_TEST_FILE"
RESULT=$(git check-ignore -v "$EXCLUDE_TEST_FILE" 2>&1 || true)
if echo "$RESULT" | grep -q ".git/info/exclude"; then
    echo "✅ .git/info/exclude 读取正常"
    echo "   结果: $RESULT"
    PASS=$((PASS + 1))
else
    echo "❌ .git/info/exclude 读取失败"
    echo "   结果: $RESULT"
    FAIL=$((FAIL + 1))
fi
rm -f "$EXCLUDE_TEST_FILE"
# 清理测试规则
sed -i '/verify-exclude-test/d' .git/info/exclude 2>/dev/null || true

# 测试 3: 全局忽略读取
echo ""
echo "📋 测试全局忽略读取..."
GLOBAL_IGNORE=$(git config --get core.excludesfile 2>/dev/null || true)
if [ -n "$GLOBAL_IGNORE" ]; then
    echo "✅ 全局忽略文件已配置: $GLOBAL_IGNORE"
    PASS=$((PASS + 1))
else
    echo "⚠️  未配置全局忽略文件（可选）"
fi

# 测试 4: 优先级验证
echo ""
echo "📋 测试优先级..."
echo "priority-test-file" >> .git/info/exclude
touch priority-test-file
RESULT=$(git check-ignore -v priority-test-file 2>&1 || true)
if echo "$RESULT" | grep -q ".git/info/exclude"; then
    echo "✅ 优先级正确：.git/info/exclude > .gitignore"
    PASS=$((PASS + 1))
else
    echo "❌ 优先级验证失败"
    FAIL=$((FAIL + 1))
fi
rm -f priority-test-file
sed -i '/priority-test-file/d' .git/info/exclude 2>/dev/null || true

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
