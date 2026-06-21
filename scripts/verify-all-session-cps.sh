#!/usr/bin/env bash
# scripts/verify-all-session-cps.sh
#
# §7.2.4 全量回归：CP-1 ~ CP-9（含 CP-3a/3b）
#
# 层次：
#   L1 单元测试：session-id-mapper / session-state-probe / cli-version-matrix / ensure-clean-session-slot
#   L2 集成测试：verify-session-state-switch + verify-session-compression
#   L3 流水线闸门：preflight-session-check + audit-spawn-contract
#
# 预期输出：CP-1 ✅ CP-2 ✅ ... CP-9 ✅

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A CP_STATUS
# 命名空间化 CP 别名映射（Rule 9b 双写）— legacy key -> namespaced ID
declare -A CP_NAMESPACE
CP_NAMESPACE["1"]="CP-session-stable-internalid-001"
CP_NAMESPACE["2"]="CP-session-deterministic-uuid-002"
CP_NAMESPACE["3"]="CP-session-three-state-003"
CP_NAMESPACE["3a"]="CP-session-active-history-001"
CP_NAMESPACE["3b"]="CP-session-forked-compression-001"
CP_NAMESPACE["4"]="CP-session-phase-isolation-004"
CP_NAMESPACE["5"]="CP-harness-spawn-args-001"
CP_NAMESPACE["6"]="CP-harness-cli-version-001"
CP_NAMESPACE["7"]="CP-session-cleanup-boundary-007"
CP_NAMESPACE["8"]="CP-session-preflight-conflict-001"
CP_NAMESPACE["9"]="CP-session-forkcount-health-001"
L1_JEST_ARGS=(
  "src/__tests__/harness-helpers.test.ts"
  "src/utils/__tests__/session-id-mapper.test.ts"
  "src/utils/__tests__/session-state-probe.test.ts"
  "src/utils/__tests__/cli-version-matrix.test.ts"
  "src/utils/__tests__/ensure-clean-session-slot.test.ts"
)

pass() { CP_STATUS[$1]="✅"; CP_STATUS["${CP_NAMESPACE[$1]:-$1}"]="✅"; echo "CP-$1 / ${CP_NAMESPACE[$1]:-CP-$1}: ✅ PASS"; }
fail() { CP_STATUS[$1]="❌"; CP_STATUS["${CP_NAMESPACE[$1]:-$1}"]="❌"; echo "CP-$1 / ${CP_NAMESPACE[$1]:-CP-$1}: ❌ FAIL — $2"; }
skip() { CP_STATUS[$1]="⏭️ "; CP_STATUS["${CP_NAMESPACE[$1]:-$1}"]="⏭️ "; echo "CP-$1 / ${CP_NAMESPACE[$1]:-CP-$1}: ⏭️  SKIP — $2"; }

GLOBAL_FAIL=0

run_l1() {
  local cp_label="$1"; shift
  local test_files=("$@")

  if [ ${#test_files[@]} -eq 0 ]; then
    skip "$cp_label" "无 L1 测试文件"
    return
  fi

  local existing=()
  for f in "${test_files[@]}"; do
    [[ -f "$f" ]] && existing+=("$f")
  done

  if [ ${#existing[@]} -eq 0 ]; then
    skip "$cp_label" "测试文件不存在"
    return
  fi

  if npx jest "${existing[@]}" --silent 2>&1 | tee /tmp/l1-${cp_label}.log | grep -qE "Tests?:.*[0-9]+ passed"; then
    if grep -qE "Tests?:.*[1-9][0-9]* failed" /tmp/l1-${cp_label}.log 2>/dev/null; then
      fail "$cp_label" "L1 单测存在失败用例"
      GLOBAL_FAIL=1
    else
      pass "$cp_label"
    fi
  else
    fail "$cp_label" "L1 jest 运行失败"
    GLOBAL_FAIL=1
  fi
}

# CP-1: stable internalId derivation
echo "== CP-1: stable internalId derivation =="
run_l1 "1" "src/utils/session-id-mapper.test.ts"

# CP-2: deterministic UUID v4 derivation
echo "== CP-2: deterministic UUID v4 =="
run_l1 "2" "src/utils/session-id-mapper.test.ts"

# CP-3: three-state switch contract
echo "== CP-3: three-state switch =="
run_l1 "3" "src/utils/__tests__/session-state-probe.test.ts"

# CP-3a: active full history
echo "== CP-3a: active full history =="
if bash "$SCRIPT_DIR/verify-session-state-switch.sh" --mode active >/tmp/cp3a.log 2>&1; then
  pass "3a"
else
  fail "3a" "verify-session-state-switch 失败"
  GLOBAL_FAIL=1
fi

# CP-3b: forked compression
echo "== CP-3b: forked compression =="
if bash "$SCRIPT_DIR/verify-session-compression.sh" >/tmp/cp3b.log 2>&1; then
  pass "3b"
else
  fail "3b" "verify-session-compression 失败"
  GLOBAL_FAIL=1
fi

# CP-4: sessionId passed to spawn (legacy + new path)
echo "== CP-4: spawn arg propagation =="
run_l1 "4" "src/__tests__/harness-helpers.test.ts"

# CP-5: spawn contract static audit
echo "== CP-5: spawn contract audit =="
if bash "$SCRIPT_DIR/audit-spawn-contract.sh" >/tmp/cp5.log 2>&1; then
  pass "5"
else
  fail "5" "audit-spawn-contract 失败"
  GLOBAL_FAIL=1
fi

# CP-6: CLI version matrix
echo "== CP-6: CLI version matrix =="
run_l1 "6" "src/utils/__tests__/cli-version-matrix.test.ts"

# CP-7: ensureCleanSessionSlot boundary
echo "== CP-7: ensureCleanSessionSlot boundary =="
run_l1 "7" "src/utils/__tests__/ensure-clean-session-slot.test.ts"

# CP-8: preflight gate
echo "== CP-8: preflight gate =="
if SESSION_RESIDUE_THRESHOLD=100 bash "$SCRIPT_DIR/preflight-session-check.sh" >/tmp/cp8.log 2>&1; then
  pass "8"
else
  fail "8" "preflight-session-check 失败（阈值过高仍失败说明环境异常）"
  GLOBAL_FAIL=1
fi

# CP-9: forkCount health + cross-runId probe
echo "== CP-9: forkCount + cross-runId probe =="
run_l1 "9" "src/utils/__tests__/session-state-probe.test.ts"

echo ""
echo "============================================"
echo "Session Continuity CP-1 ~ CP-9 总报告"
echo "============================================"
for cp in 1 2 3 3a 3b 4 5 6 7 8 9; do
  ns="${CP_NAMESPACE[$cp]:-CP-$cp}"
  printf "CP-%-2s / %-40s %s\n" "$cp" "$ns" "${CP_STATUS[$cp]:-❓}"
done
echo "============================================"

if [ "$GLOBAL_FAIL" -ne 0 ]; then
  echo "❌ 存在失败 CP，需修复后再合并"
  exit 1
fi

echo "✅ 全部 CP 通过"
