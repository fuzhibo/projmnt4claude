#!/usr/bin/env bash
# scripts/verify-session-compression.sh
#
# §7.2.2 CP-3b: forked 态会话压缩（V2.1 核心机制）
#
# 原理：跨流水线注入 MARKER_OLD，断言新流水线首次输出**不包含**该标记、
#       forkCount 递增、cliUuid 不变、runId 切换。
#
# 失败信号：
#   - 输出含 MARKER_OLD → 压缩失败（fork-session 未生效）
#   - forkCount 未递增 → 状态探测错误
#   - cliUuid 变更 → 确定性派生被破坏
#   - runId 未切换 → resolveRunId 未识别新流水线

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "[verify-compression] CP-3b forked 会话压缩验证"
echo "[verify-compression] 运行：session-state-probe.test.ts (compression 子集)"

npx jest src/utils/__tests__/session-state-probe.test.ts \
  -t "forked compresses history" \
  --silent 2>&1 | tee /tmp/verify-compression.log

if ! grep -qE "Tests?:.*[0-9]+ passed" /tmp/verify-compression.log; then
  echo "❌ CP-3b 会话压缩单测未通过"
  echo "   可能原因："
  echo "   - cliUuid 在 fork 时被改写（确定性派生被破坏）"
  echo "   - forkCount 未递增（probeSessionState 状态机错误）"
  echo "   - runId 未切换（resolveRunId 未生效）"
  exit 1
fi

echo "✅ CP-3b 通过（MARKER_OLD 不泄漏、forkCount 递增、cliUuid 稳定）"
