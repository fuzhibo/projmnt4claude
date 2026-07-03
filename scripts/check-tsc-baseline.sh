#!/usr/bin/env bash
set -e

CURRENT=$(mktemp)
trap 'rm -f "$CURRENT"' EXIT

bun run typecheck 2>&1 | grep "error TS" > "$CURRENT" || true

NEW_ERRORS=$(comm -13 <(sort .tsc-error-baseline.txt) <(sort "$CURRENT") || true)

if [ -n "$NEW_ERRORS" ]; then
  echo "❌ 发现新增 TypeScript 错误："
  echo "$NEW_ERRORS"
  exit 1
fi

echo "✅ 无新增 TypeScript 错误"