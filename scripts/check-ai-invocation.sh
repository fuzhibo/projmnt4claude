#!/bin/bash

# check-ai-invocation.sh - AI 调用规范检查脚本
#
# 功能:
#   1. 检查是否存在直接使用 fetch 调用 AI API 的代码
#   2. 检查是否正确使用 withAIEnhancement 封装
#   3. 检查是否缺少 fallback 机制的 AI 调用
#
# 用法:
#   ./scripts/check-ai-invocation.sh          # 检查 src/ 目录
#   ./scripts/check-ai-invocation.sh --fix    # 尝试自动修复（仅建议模式）
#   ./scripts/check-ai-invocation.sh --help   # 显示帮助

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
SRC_DIR="${SRC_DIR:-src}"
EXIT_CODE=0
VIOLATIONS=0
WARNINGS=0

# 帮助信息
show_help() {
  cat << EOF
AI Invocation Check Script

Usage:
  $0 [options]

Options:
  --fix       Show fix suggestions (dry-run only)
  --help      Show this help message
  --strict    Exit with error on warnings too

Environment:
  SRC_DIR     Source directory to check (default: src)

Examples:
  $0                    # Check src/ directory
  SRC_DIR=lib $0        # Check lib/ directory
  $0 --strict           # Fail on warnings too
EOF
}

# 解析参数
STRICT_MODE=false
SHOW_FIX=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      show_help
      exit 0
      ;;
    --strict)
      STRICT_MODE=true
      shift
      ;;
    --fix)
      SHOW_FIX=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

echo "🔍 Checking AI invocation patterns in $SRC_DIR/..."
echo ""

# 检查 1: 直接使用 fetch 调用 AI API (排除测试文件和特定允许的文件)
echo "📋 Check 1: Direct fetch calls to AI APIs"
echo "----------------------------------------"

# 查找直接使用 fetch 的模式（排除测试文件和 api/auth.ts）
FETCH_VIOLATIONS=$(grep -rn "fetch\s*(" "$SRC_DIR" --include="*.ts" --include="*.js" 2>/dev/null | \
  grep -v "__tests__" | \
  grep -v ".test.ts" | \
  grep -v "src/api/auth.ts" | \
  grep -v "//.*fetch" | \
  grep -v "/\*.*fetch" || true)

if [ -n "$FETCH_VIOLATIONS" ]; then
  echo -e "${RED}❌ Found direct fetch calls:${NC}"
  echo "$FETCH_VIOLATIONS" | while read -r line; do
    echo "   $line"
  done
  echo ""
  echo -e "${YELLOW}⚠️  Direct fetch calls should use AIMetadataAssistant instead.${NC}"
  echo "   See: docs/ai-invocation-guidelines.md"
  echo ""
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}✅ No direct fetch calls found${NC}"
fi
echo ""

# 检查 2: AIMetadataAssistant 实例化是否使用 withAIEnhancement 封装
echo "📋 Check 2: AIMetadataAssistant usage patterns"
echo "----------------------------------------------"

# 查找直接实例化 AIMetadataAssistant 并调用方法的模式
DIRECT_AI_CALLS=$(grep -rn "new AIMetadataAssistant" "$SRC_DIR" --include="*.ts" --include="*.js" 2>/dev/null | \
  grep -v "__tests__" | \
  grep -v ".test.ts" | \
  grep -v "withAIEnhancement" | \
  grep -v "ai-metadata-assistant.ts" | \
  grep -v "//.*new AIMetadataAssistant" || true)

# 检查是否在 withAIEnhancement 的 aiCall 回调中
if [ -n "$DIRECT_AI_CALLS" ]; then
  # 需要进一步检查这些调用是否在 withAIEnhancement 中
  VIOLATION_LINES=""

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file=$(echo "$line" | cut -d':' -f1)
    lineno=$(echo "$line" | cut -d':' -f2)

    # 检查上下文是否包含 withAIEnhancement
    # 读取前后 15 行（增加范围以捕获更大的代码块）
    start=$((lineno - 15))
    [ $start -lt 1 ] && start=1
    context=$(sed -n "${start},$((lineno + 15))p" "$file" 2>/dev/null || true)

    if ! echo "$context" | grep -q "withAIEnhancement"; then
      VIOLATION_LINES="${VIOLATION_LINES}${line}\n"
    fi
  done <<< "$DIRECT_AI_CALLS"

  if [ -n "$VIOLATION_LINES" ]; then
    echo -e "${RED}❌ Found unwrapped AIMetadataAssistant calls:${NC}"
    echo -e "$VIOLATION_LINES" | while read -r line; do
      [ -n "$line" ] && echo "   $line"
    done
    echo ""
    echo -e "${YELLOW}⚠️  AIMetadataAssistant calls should be wrapped with withAIEnhancement.${NC}"
    echo "   See: docs/ai-invocation-guidelines.md"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo -e "${GREEN}✅ All AIMetadataAssistant calls properly wrapped${NC}"
  fi
else
  echo -e "${GREEN}✅ No direct AIMetadataAssistant calls found${NC}"
fi
echo ""

# 检查 3: 检查 withAIEnhancement 调用是否完整
echo "📋 Check 3: withAIEnhancement call completeness"
echo "-----------------------------------------------"

# 查找 withAIEnhancement 调用并检查是否包含所有必需字段
INCOMPLETE_CALLS=""

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # 提取 withAIEnhancement 调用的行号
  grep -n "withAIEnhancement" "$file" 2>/dev/null | while IFS= read -r match; do
    lineno=$(echo "$match" | cut -d':' -f1)

    # 读取调用块（多行）
    start=$((lineno))
    end=$((lineno + 10))
    block=$(sed -n "${start},${end}p" "$file" 2>/dev/null || true)

    # 检查必需字段
    missing=""
    if ! echo "$block" | grep -q "enabled"; then
      missing="$missing enabled"
    fi
    if ! echo "$block" | grep -q "aiCall"; then
      missing="$missing aiCall"
    fi
    if ! echo "$block" | grep -q "fallback"; then
      missing="$missing fallback"
    fi
    if ! echo "$block" | grep -q "operationName"; then
      missing="$missing operationName"
    fi

    if [ -n "$missing" ]; then
      echo "   $file:$lineno - Missing:$missing"
      INCOMPLETE_CALLS="yes"
    fi
  done
done < <(find "$SRC_DIR" -name "*.ts" -o -name "*.js" 2>/dev/null | grep -v "__tests__" | grep -v ".test.ts")

if [ -n "$INCOMPLETE_CALLS" ]; then
  echo -e "${RED}❌ Found incomplete withAIEnhancement calls:${NC}"
  echo ""
  echo -e "${YELLOW}⚠️  withAIEnhancement requires: enabled, aiCall, fallback, operationName${NC}"
  echo "   See: docs/ai-invocation-guidelines.md"
  echo ""
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo -e "${GREEN}✅ All withAIEnhancement calls are complete${NC}"
fi
echo ""

# 检查 4: 检查是否存在直接导入 AI SDK 的情况
echo "📋 Check 4: Direct AI SDK imports"
echo "---------------------------------"

DIRECT_SDK_IMPORTS=$(grep -rn "from ['\"]@anthropic" "$SRC_DIR" --include="*.ts" --include="*.js" 2>/dev/null | \
  grep -v "__tests__" | \
  grep -v ".test.ts" || true)

if [ -n "$DIRECT_SDK_IMPORTS" ]; then
  echo -e "${YELLOW}⚠️  Found direct Anthropic SDK imports:${NC}"
  echo "$DIRECT_SDK_IMPORTS" | while read -r line; do
    echo "   $line"
  done
  echo ""
  echo -e "${BLUE}ℹ️  Direct SDK imports are allowed in specific utility files only.${NC}"
  echo "   Ensure these are in the proper abstraction layer."
  echo ""
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "${GREEN}✅ No direct AI SDK imports found${NC}"
fi
echo ""

# 总结
echo "============================================"
echo "📊 Check Summary"
echo "============================================"
echo ""

if [ $VIOLATIONS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ All AI invocation checks passed!${NC}"
  echo ""
  echo "Your code follows the AI invocation guidelines."
  exit 0
elif [ $VIOLATIONS -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Found $WARNINGS warning(s)${NC}"
  echo ""
  echo "Warnings should be reviewed but won't fail the build."
  if [ "$STRICT_MODE" = true ]; then
    echo -e "${RED}❌ Strict mode enabled: treating warnings as errors${NC}"
    exit 1
  fi
  exit 0
else
  echo -e "${RED}❌ Found $VIOLATIONS violation(s) and $WARNINGS warning(s)${NC}"
  echo ""
  echo "Please fix the violations before committing."
  echo "See: docs/ai-invocation-guidelines.md"
  echo ""
  exit 1
fi
