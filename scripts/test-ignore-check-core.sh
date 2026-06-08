#!/bin/bash
# scripts/test-ignore-check-core.sh
# 直接测试 pre-commit hook 的忽略文件检查核心逻辑
# 不执行完整的 git commit，仅测试检测机制

echo "=== 忽略文件检查核心逻辑测试 ==="

PASS=0
FAIL=0

# 测试函数：模拟 pre-commit hook 的忽略文件检查
test_ignore_check() {
    local FILE=$1
    local EXPECT_BLOCK=$2  # "yes" 或 "no"

    # 检查文件是否应该被忽略
    if git check-ignore -q "$FILE" 2>/dev/null; then
        IGNORE_SOURCE=$(git check-ignore -v "$FILE" 2>/dev/null | cut -d: -f1)
        if [ "$EXPECT_BLOCK" = "yes" ]; then
            echo "✅ 正确检测: $FILE 应被忽略 (来源: $IGNORE_SOURCE)"
            return 0
        else
            echo "❌ 错误检测: $FILE 不应被忽略但被检测为忽略 (来源: $IGNORE_SOURCE)"
            return 1
        fi
    else
        if [ "$EXPECT_BLOCK" = "no" ]; then
            echo "✅ 正确放行: $FILE 不在忽略列表中"
            return 0
        else
            echo "❌ 错误放行: $FILE 应被忽略但未被检测"
            return 1
        fi
    fi
}

# 测试 1: .gitignore 中的文件
echo ""
echo "📋 测试 1: .gitignore 文件检测..."
echo "test" > .env
test_ignore_check ".env" "yes"
RESULT=$?
rm -f .env
if [ $RESULT -eq 0 ]; then
    PASS=$((PASS + 1))
else
    FAIL=$((FAIL + 1))
fi

# 测试 2: .git/info/exclude 中的文件
echo ""
echo "📋 测试 2: .git/info/exclude 文件检测..."
EXCLUDE_TEST="exclude-core-test-$(date +%s)"
echo "$EXCLUDE_TEST" >> .git/info/exclude
touch "$EXCLUDE_TEST"
test_ignore_check "$EXCLUDE_TEST" "yes"
RESULT=$?
rm -f "$EXCLUDE_TEST"
sed -i "/$EXCLUDE_TEST/d" .git/info/exclude 2>/dev/null || true
if [ $RESULT -eq 0 ]; then
    PASS=$((PASS + 1))
else
    FAIL=$((FAIL + 1))
fi

# 测试 3: 正常文件不被阻止
echo ""
echo "📋 测试 3: 正常文件不被阻止..."
NORMAL_TEST="normal-test-$(date +%s).txt"
echo "test" > "$NORMAL_TEST"
test_ignore_check "$NORMAL_TEST" "no"
RESULT=$?
rm -f "$NORMAL_TEST"
if [ $RESULT -eq 0 ]; then
    PASS=$((PASS + 1))
else
    FAIL=$((FAIL + 1))
fi

# 测试 4: .projmnt4claude 目录
echo ""
echo "📋 测试 4: .projmnt4claude 目录检测..."
mkdir -p .projmnt4claude/test-dir
echo "test" > .projmnt4claude/test-dir/test.json
test_ignore_check ".projmnt4claude/test-dir/test.json" "yes"
RESULT=$?
rm -rf .projmnt4claude/test-dir
if [ $RESULT -eq 0 ]; then
    PASS=$((PASS + 1))
else
    FAIL=$((FAIL + 1))
fi

# 测试 5: 显示忽略来源
echo ""
echo "📋 测试 5: 忽略来源显示..."
echo "test" > .env
IGNORE_SOURCE=$(git check-ignore -v .env 2>/dev/null | cut -d: -f1)
if [ -n "$IGNORE_SOURCE" ] && echo "$IGNORE_SOURCE" | grep -q ".gitignore"; then
    echo "✅ 忽略来源正确: $IGNORE_SOURCE"
    PASS=$((PASS + 1))
else
    echo "❌ 忽略来源显示失败"
    FAIL=$((FAIL + 1))
fi
rm -f .env

echo ""
echo "============================================"
echo "=== 测试结果 ==="
echo "============================================"
echo "✅ 通过: $PASS"
echo "❌ 失败: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi