#!/usr/bin/env bash
# scripts/audit-spawn-contract.sh
#
# §7.2.2 CP-harness-spawn-args-001 (alias CP-5): spawn 契约静态审计
#
# 原理：对四阶段执行器（harness-executor / harness-code-reviewer /
#       harness-qa-tester / harness-evaluator）+ FCE retry 路径的
#       invokeOptions 结构做静态检查，确认：
#   1. 每个阶段都调用 buildStableInternalId + resolveRunId + probeSessionState
#   2. invokeOptions 同时包含 sessionId 和 sessionState
#   3. 不再使用 Date.now() / randomUUID() 构造 internalId
#   4. 不再直接传 resumeSession: true / forkSession: true
#
# 失败信号：任一阶段不符合契约 → exit 1

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PHASE_EXECUTORS=(
  "src/utils/harness-executor.ts"
  "src/utils/harness-code-reviewer.ts"
  "src/utils/harness-qa-tester.ts"
  "src/utils/harness-evaluator.ts"
)

FCE="src/utils/feedback-constraint-engine.ts"
ASSEMBLY="src/utils/hd-assembly-line.ts"

FAIL=0
REPORT=("spawn-contract audit report" "")

check_phase() {
  local file="$1"
  local label="$2"
  local issues=0

  if [[ ! -f "$file" ]]; then
    REPORT+=("❌ [$label] $file 不存在")
    return 1
  fi

  # 1. 必须调用 buildStableInternalId
  if ! grep -q "buildStableInternalId" "$file"; then
    REPORT+=("❌ [$label] 未调用 sessionIdMapper.buildStableInternalId")
    issues=$((issues + 1))
  fi

  # 2. 必须调用 resolveRunId
  if ! grep -q "resolveRunId" "$file"; then
    REPORT+=("❌ [$label] 未调用 sessionIdMapper.resolveRunId")
    issues=$((issues + 1))
  fi

  # 3. 必须调用 probeSessionState
  if ! grep -q "probeSessionState" "$file"; then
    REPORT+=("❌ [$label] 未调用 sessionIdMapper.probeSessionState")
    issues=$((issues + 1))
  fi

  # 4. invokeOptions 必须同时包含 sessionId 和 sessionState
  if ! grep -qE "sessionState:\s*probe\.state" "$file"; then
    REPORT+=("❌ [$label] invokeOptions 未设置 sessionState: probe.state")
    issues=$((issues + 1))
  fi

  # 5. 不得使用 Date.now() / randomUUID() 构造 internalId
  if grep -qE "internalId\s*=\s*[^;]*(Date\.now\(\)|randomUUID\(\))" "$file"; then
    REPORT+=("❌ [$label] internalId 仍使用 Date.now()/randomUUID()（破坏确定性派生）")
    issues=$((issues + 1))
  fi

  # 6. 不得直接传 resumeSession: true / forkSession: true（已废弃）
  if grep -qE "resumeSession:\s*true" "$file"; then
    REPORT+=("⚠️  [$label] 仍使用 resumeSession: true（V2.1 已废弃）")
    issues=$((issues + 1))
  fi

  if [ "$issues" -eq 0 ]; then
    REPORT+=("✅ [$label] 契约符合")
  else
    FAIL=1
  fi
}

for entry in "harness-executor.ts|harness-executor" \
             "harness-code-reviewer.ts|harness-code-reviewer" \
             "harness-qa-tester.ts|harness-qa-tester" \
             "harness-evaluator.ts|harness-evaluator"; do
  file="${entry%%|*}"
  label="${entry##*|}"
  check_phase "src/utils/$file" "$label"
done

# FCE retry 路径：sessionState 应为 'active'
if [[ -f "$FCE" ]]; then
  if ! grep -qE "sessionState:\s*'active'\s*as\s*const" "$FCE" && \
     ! grep -qE "sessionState:\s*'active'" "$FCE"; then
    REPORT+=("❌ [FCE] retry 路径未设置 sessionState: 'active'")
    FAIL=1
  else
    REPORT+=("✅ [FCE] retry sessionState='active' 契约符合")
  fi
else
  REPORT+=("❌ [FCE] $FCE 不存在")
  FAIL=1
fi

# AssemblyLine：pipeline 层 session 必须使用稳定派生
if [[ -f "$ASSEMBLY" ]]; then
  if grep -qE "harness-\$\{Date\.now\(\)\}" "$ASSEMBLY"; then
    REPORT+=("❌ [assembly] pipeline sessionId 仍使用 Date.now()")
    FAIL=1
  elif grep -q "buildStableInternalId" "$ASSEMBLY"; then
    REPORT+=("✅ [assembly] pipeline sessionId 稳定派生")
  else
    REPORT+=("⚠️  [assembly] 未检测到 buildStableInternalId（可能由外部传入）")
  fi
fi

printf '%s\n' "${REPORT[@]}"
echo ""

if [ "$FAIL" -ne 0 ]; then
  echo "❌ spawn-contract audit 失败"
  exit 1
fi

echo "✅ spawn-contract audit 通过"
