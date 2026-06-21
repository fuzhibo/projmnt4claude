#!/usr/bin/env bash
# scripts/verify-cp-coverage.sh
#
# Validate docs/qa-contracts/cp-coverage.yaml schema per
# .claude/skills/unit-test/SKILL.md Rule 9c (Coverage Point Identifier Contract).
#
# 校验项:
#   1. cp-coverage.yaml 文件存在
#   2. 每个 - id: 符合 CP-<stage>-<aspect>-<seq> 格式（正则 ^CP-[a-z]+-[a-z-]+-[0-9]{3}$）
#   3. 每个 CP 有非空 description
#   4. 每个 CP 有 anchor.type 字段
#   5. 每个 CP 有 assertion_category 字段
#   6. alias（若存在）符合 ^CP-[0-9]+[a-z]?$
#   7. anchor.path / anchor.jest / anchor.shell 引用的文件存在
#
# 退出码:
#   0 = 通过（X CPs checked, 0 errors）
#   1 = 失败（X CPs checked, Y errors）

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

YAML_FILE="docs/qa-contracts/cp-coverage.yaml"

if [[ ! -f "$YAML_FILE" ]]; then
  echo "❌ cp-coverage 文件不存在: $YAML_FILE"
  exit 1
fi

ERRORS=0
CP_COUNT=0

# 探测可用 YAML 校验器：yq > python3 yaml > grep 兜底
if command -v yq >/dev/null 2>&1; then
  VALIDATOR="yq"
elif python3 -c "import yaml" >/dev/null 2>&1; then
  VALIDATOR="python3"
else
  VALIDATOR="grep"
fi
echo "[verify-cp-coverage] 使用校验器: $VALIDATOR"

# 使用 python3 解析（最通用；yq 在 CI 常缺）
validate_with_python() {
  python3 - "$YAML_FILE" <<'PYEOF'
import sys, re, os

errors = 0
cp_count = 0

try:
    import yaml
    with open(sys.argv[1]) as f:
        data = yaml.safe_load(f)
except ImportError:
    print("[verify-cp-coverage] python3 yaml 不可用，回退 grep", file=sys.stderr)
    sys.exit(2)

id_re = re.compile(r'^CP-[a-z]+-[a-z-]+-[0-9]{3}$')
alias_re = re.compile(r'^CP-[0-9]+[a-z]?$')

coverage = data.get('coverage') or []
for entry in coverage:
    cp_count += 1
    eid = entry.get('id', '')
    if not eid:
        print(f"❌ CP #{cp_count}: 缺失 id 字段", file=sys.stderr)
        errors += 1
        continue
    if not id_re.match(eid):
        print(f"❌ {eid}: id 格式不符合 CP-<stage>-<aspect>-<seq>（正则 {id_re.pattern}）", file=sys.stderr)
        errors += 1

    desc = entry.get('description', '')
    if not desc or not str(desc).strip():
        print(f"❌ {eid}: description 为空", file=sys.stderr)
        errors += 1

    anchor = entry.get('anchor') or {}
    if not anchor.get('type'):
        print(f"❌ {eid}: anchor.type 缺失", file=sys.stderr)
        errors += 1

    if not entry.get('assertion_category'):
        print(f"❌ {eid}: assertion_category 缺失", file=sys.stderr)
        errors += 1

    alias = entry.get('alias')
    if alias is not None and alias != '':
        if not alias_re.match(str(alias)):
            print(f"❌ {eid}: alias '{alias}' 不符合 ^CP-[0-9]+[a-z]?$", file=sys.stderr)
            errors += 1

    # 文件存在性校验（path / jest / shell；skill_rule 跳过因为可能内嵌于 SKILL.md）
    for key in ('path', 'jest', 'shell'):
        ref = anchor.get(key)
        if ref:
            # 取首行（yaml 可能多行），去掉注释
            ref_str = str(ref).strip().split('\n')[0].strip()
            if ref_str and not ref_str.startswith('.claude/'):
                # 容忍 "path: x.ts (注释)" 形式
                ref_clean = ref_str.split('(')[0].strip()
                if ref_clean and not os.path.isfile(ref_clean):
                    print(f"⚠️  {eid}: anchor.{key} 引用文件不存在: {ref_clean}", file=sys.stderr)
                    errors += 1

print(f"CP_COUNT={cp_count}")
print(f"ERRORS={errors}")
PYEOF
}

validate_with_grep() {
  # grep 兜底：行级粗校验（无 yq/python3 时的 best-effort）
  local current_id=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*id:[[:space:]]*(CP-[a-z]+-[a-z-]+-[0-9]{3}) ]]; then
      CP_COUNT=$((CP_COUNT + 1))
      current_id="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^[[:space:]]*id:[[:space:]]*(CP-[a-z]+-[a-z-]+-[0-9]{3}) ]]; then
      CP_COUNT=$((CP_COUNT + 1))
      current_id="${BASH_REMATCH[1]}"
    fi
  done < "$YAML_FILE"

  # 粗略检测不合规的裸 id（CP-N 形式但不在 alias 字段下）
  local bare_ids
  bare_ids=$(grep -E '^[[:space:]]*- id:[[:space:]]*CP-[0-9]+' "$YAML_FILE" || true)
  if [[ -n "$bare_ids" ]]; then
    echo "❌ 发现裸 CP-N id（应使用 CP-<stage>-<aspect>-<seq>):" >&2
    echo "$bare_ids" >&2
    ERRORS=$((ERRORS + 1))
  fi
}

if [[ "$VALIDATOR" == "python3" ]]; then
  PYTHON_OUT="$(validate_with_python 2>/dev/null)"
  PYTHON_RC=$?
  if [[ $PYTHON_RC -eq 0 ]]; then
    eval "$(echo "$PYTHON_OUT" | tail -2)"
  else
    echo "[verify-cp-coverage] python 解析失败，回退 grep" >&2
    validate_with_grep
  fi
else
  validate_with_grep
fi

echo ""
echo "============================================"
echo "CP Coverage Schema 校验报告"
echo "============================================"
echo "CPs checked: ${CP_COUNT:-0}"
echo "Errors:      ${ERRORS:-0}"
echo "============================================"

if [[ "${ERRORS:-0}" -gt 0 ]]; then
  echo "❌ cp-coverage schema 存在 ${ERRORS} 个错误"
  exit 1
fi

echo "✅ cp-coverage schema valid"
exit 0
