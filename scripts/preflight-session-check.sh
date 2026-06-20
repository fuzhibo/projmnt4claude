#!/usr/bin/env bash
# scripts/preflight-session-check.sh
#
# §6.1.6.3 Pre-flight 检查（流水线启动闸门）
# §7.2.3 流水线闸门：检测 session 残留与 forkCount 健康度
#
# 用法：
#   bash scripts/preflight-session-check.sh                # 基础残留检查
#   bash scripts/preflight-session-check.sh --check-fork-count  # 额外检查 forkCount
#
# 退出码：
#   0 = 通过
#   1 = 超阈值 / forkCount 异常

set -euo pipefail

PROJECT_HASH=$(pwd | sha256sum | cut -c1-16)
SESSION_ENV_DIR="$HOME/.claude/session-env"
PROJECT_DIR="$HOME/.claude/projects/$PROJECT_HASH"
META_JSON=".projmnt4claude/meta.json"

CHECK_FORK_COUNT=0
if [[ "${1:-}" == "--check-fork-count" ]]; then
  CHECK_FORK_COUNT=1
fi

# 统计残留 session（目录不存在时回退到 0，避免 set -o pipefail 触发早退）
SESSION_ENV_COUNT=0
if [[ -d "$SESSION_ENV_DIR" ]]; then
  SESSION_ENV_COUNT=$(find "$SESSION_ENV_DIR" -maxdepth 1 -type d 2>/dev/null | wc -l)
fi
PROJECT_COUNT=0
if [[ -d "$PROJECT_DIR" ]]; then
  PROJECT_COUNT=$(find "$PROJECT_DIR" -name "*.jsonl" 2>/dev/null | wc -l)
fi

THRESHOLD="${SESSION_RESIDUE_THRESHOLD:-10}"
FORK_COUNT_WARN_THRESHOLD="${FORK_COUNT_WARN_THRESHOLD:-5}"

echo "[preflight] project-hash: $PROJECT_HASH"
echo "[preflight] session-env 残留: $((SESSION_ENV_COUNT - 1))"
echo "[preflight] project jsonl 残留: $PROJECT_COUNT"
echo "[preflight] session-env 阈值: $THRESHOLD"

FAIL=0

# 基础残留检查
if [ "$SESSION_ENV_COUNT" -gt "$THRESHOLD" ]; then
  echo "❌ session-env 残留 ($SESSION_ENV_COUNT) 超过阈值 ($THRESHOLD)，可能触发 'already in use' 冲突"
  echo "   清理建议: rm -rf $SESSION_ENV_DIR/*"
  FAIL=1
fi

# forkCount 健康度检查（V2.1 §7.2.3）
if [ "$CHECK_FORK_COUNT" -eq 1 ]; then
  echo "[preflight] forkCount 健康度检查（阈值: $FORK_COUNT_WARN_THRESHOLD）"
  if [ -f "$META_JSON" ]; then
    if command -v jq >/dev/null 2>&1; then
      HIGH_FORK_COUNT=$(jq -r --arg t "$FORK_COUNT_WARN_THRESHOLD" '
        [.sessionMappings // [] | to_entries[]
          | select((.value.forkCount // 0) > ($t | tonumber))
          | {internalId: .key, forkCount: .value.forkCount, taskId: .value.taskId, phase: .value.phase}
        ] | length' "$META_JSON" 2>/dev/null || echo "0")
      if [ "$HIGH_FORK_COUNT" -gt 0 ]; then
        echo "❌ 发现 $HIGH_FORK_COUNT 条 forkCount > $FORK_COUNT_WARN_THRESHOLD 的记录，提示任务不稳定"
        jq -r --arg t "$FORK_COUNT_WARN_THRESHOLD" '
          .sessionMappings // [] | to_entries[]
            | select((.value.forkCount // 0) > ($t | tonumber))
            | "  - \(.value.taskId)/\(.value.phase): forkCount=\(.value.forkCount) (\(.key))"' "$META_JSON" 2>/dev/null || true
        echo "   建议人工排查根因：是否存在反复 retry/资源争抢"
        FAIL=1
      else
        echo "[preflight] forkCount 全部 ≤ $FORK_COUNT_WARN_THRESHOLD"
      fi
    else
      echo "[preflight] WARN: jq 未安装，跳过 forkCount 检查"
    fi
  else
    echo "[preflight] $META_JSON 不存在，跳过 forkCount 检查"
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "✅ preflight 通过"
