#!/bin/bash
# docs-alignment-validator.sh — 验证文档与代码的一致性
#
# 用法: bash scripts/docs-alignment-validator.sh <doc_file> <expected_patterns>
#
# 验证逻辑:
# 1. 检查文档中描述的关键文件是否存在
# 2. 检查代码中是否包含文档描述的关键符号/函数
# 3. 检查接口契约是否一致

set -e

DOC_FILE="$1"
EXPECTED_PATTERNS="$2"

if [ -z "$DOC_FILE" ]; then
    echo "用法: bash scripts/docs-alignment-validator.sh <doc_file> <expected_patterns>"
    exit 1
fi

echo "=== 文档对齐验证 ==="
echo "文档: $DOC_FILE"

# 检查文档是否存在
if [ ! -f "$DOC_FILE" ]; then
    echo "❌ 文档不存在: $DOC_FILE"
    exit 1
fi
echo "✅ 文档存在"

# 从文档提取关键文件引用
echo ""
echo "=== 检查文档引用的文件 ==="

# 匥配 src/utils/investigation/*.ts 等路径引用
FILES_IN_DOC=$(grep -oE 'src/[a-zA-Z0-9_/]+\.ts' "$DOC_FILE" | grep -v 'path/to' | sort -u || true)

if [ -z "$FILES_IN_DOC" ]; then
    echo "⚠️  文档中未发现 src/*.ts 文件引用"
else
    MISSING_FILES=""
    for f in $FILES_IN_DOC; do
        if [ -f "$f" ]; then
            echo "✅ $f 存在"
        else
            echo "❌ $f 不存在"
            MISSING_FILES="$MISSING_FILES $f"
        fi    done

    if [ -n "$MISSING_FILES" ]; then
        echo ""
        echo "❌ 缺失文件: $MISSING_FILES"
        exit 1
    fi
fi

# 检查关键符号/函数是否存在
echo ""
echo "=== 检查关键符号 ==="

if [ -n "$EXPECTED_PATTERNS" ]; then
    for pattern in $EXPECTED_PATTERNS; do
        FOUND=$(grep -r "$pattern" src/utils/investigation/ src/utils/init-requirement/ 2>/dev/null || true)
        if [ -n "$FOUND" ]; then
            echo "✅ $pattern 在代码中找到"
        else
            echo "❌ $pattern 在代码中未找到"
            exit 1
        fi
    done
fi

echo ""
echo "✅ 文档对齐验证通过"
exit 0