#!/usr/bin/env bash
# scripts/verify-session-state-switch.sh
#
# §7.2.2 CP-3: 三态切换契约验证
# §7.2.2 CP-3a: active 态读完整历史（反馈修正闭环）
#
# 用法：
#   bash scripts/verify-session-state-switch.sh              # 默认 active 模式
#   bash scripts/verify-session-state-switch.sh --mode active
#
# 原理：注入 MARKER_A 作为唯一可识别 token，retry 时断言 Claude
# 仍能"读到"该 token（证明 session 连续性成立、sessionState=active 生效）。
#
# 失败信号：retry 输出无 MARKER_A → exit 1

set -euo pipefail

MODE="active"
if [[ "${1:-}" == "--mode" ]]; then
  MODE="${2:-active}"
fi

if [[ "$MODE" != "active" ]]; then
  echo "[verify-state-switch] 当前仅支持 active 模式（got: $MODE）"
  exit 1
fi

echo "[verify-state-switch] 模式: $MODE"
echo "[verify-state-switch] 调用：session-state-probe.test.ts (CP-3 单测)"
echo "[verify-state-switch] 断言：fresh/active/forked 三态 CLI 参数构造正确"

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

npx jest src/utils/__tests__/session-state-probe.test.ts \
  -t "session state switch" \
  --silent 2>&1 | tee /tmp/verify-state-switch.log

if ! grep -qE "Tests?:.*[0-9]+ passed" /tmp/verify-state-switch.log; then
  echo "❌ CP-3 单测未通过"
  exit 1
fi

echo ""
echo "[verify-state-switch] CP-3a active 端到端（MARKER_A 闭环）"
echo "[verify-state-switch] 运行 session-state-probe.test.ts (active history 闭环)"

npx jest src/utils/__tests__/session-state-probe.test.ts \
  -t "active reads full history" \
  --silent 2>&1 | tee -a /tmp/verify-state-switch.log

if ! grep -qE "Tests?:.*[0-9]+ passed" /tmp/verify-state-switch.log; then
  echo "❌ CP-3a active 端到端未通过（MARKER_A 未在 retry 中出现）"
  exit 1
fi

echo "✅ CP-3 + CP-3a 通过"
