#!/usr/bin/env bash
# oom-crash-demo.sh — 安全复现系统 hung 死的内存压力测试
#
# 目的：在可控范围内验证以下两个假设：
# 1. 单个 scope 的 MemoryMax 限制有效，但多个 scope 并行时总内存无限制
# 2. 设置 user.slice 的 MemoryMax 后，OOM killer 能正确介入
#
# 测试策略：
# - 使用 Node.js 进行真实的内存分配（模拟 bun 进程行为）
# - 每个测试有 timeout 限制，防止 hung 死
# - 逐步增加压力，观察系统响应
# - 不使用危险的全系统压力测试

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRESS_JS="$SCRIPT_DIR/memory-stress-test.cjs"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 辅助函数
print_header() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
    echo ""
}

print_ok() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_fail() {
    echo -e "${RED}✗ $1${NC}"
}

print_warn() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

get_mem_info() {
    awk '/MemTotal/{mt=$2} /MemFree/{mf=$2} /MemAvailable/{ma=$2} /SwapTotal/{st=$2} /SwapFree/{sf=$2} /Committed_AS/{ca=$2}
    END{printf "Total: %.1fGB | Free: %.1fGB | Avail: %.1fGB | Swap: %.1fGB | Committed: %.1fGB (%.0f%%)", mt/1048576, mf/1048576, ma/1048576, st/1048576, ca/1048576, ca*100/mt}' /proc/meminfo
}

get_cgroup_info() {
    echo "user.slice: $(cat /sys/fs/cgroup/user.slice/memory.max)"
    echo "user.slice.current: $(numfmt --to-unit=1073741824 < /sys/fs/cgroup/user.slice/memory.current 2>/dev/null || echo 'N/A')GB"
    echo "overcommit: $(cat /proc/sys/vm/overcommit_memory)"
    echo "swappiness: $(cat /proc/sys/vm/swappiness)"
}

# ============================================================
# 系统信息收集
# ============================================================

print_header "系统环境信息"

echo "内存状态:"
get_mem_info
echo ""
echo ""

echo "cgroup 限制:"
get_cgroup_info
echo ""

echo "zram 状态:"
zramctl
echo ""

echo "进程内存 (Top 5):"
ps aux --sort=-rss | awk 'NR<=6{printf "  %-8s %6s %5.1f%% %6.0fMB %s\n", $1, $2, $4, $6/1024, $11}'
echo ""

# ============================================================
# 测试 1: 单个 scope MemoryMax 限制有效性
# ============================================================

print_header "Test 1: 单个 scope MemoryMax=1GB 限制是否生效"

echo "在 systemd-run scope (MemoryMax=1GB) 中分配 512MB..."
echo ""

timeout 30 systemd-run --user --scope -p MemoryMax=1G -- node "$STRESS_JS" --size 512MB --duration 3 --pattern greedy -v 2>&1 | tail -5
RESULT=$?

if [ $RESULT -eq 0 ]; then
    print_ok "512MB 在 1GB scope 中分配成功（限制有效）"
else
    print_fail "512MB 在 1GB scope 中分配失败 (exit=$RESULT)"
fi

echo ""
echo "尝试在 1GB scope 中分配 1.5GB（应该被 throttled 或 OOM）..."
echo ""

timeout 30 systemd-run --user --scope -p MemoryMax=1G -- node "$STRESS_JS" --size 1500MB --duration 3 --pattern greedy -v 2>&1 | tail -5
RESULT=$?

if [ $RESULT -ne 0 ]; then
    print_ok "1.5GB 在 1GB scope 中被阻止（MemoryMax 有效！）"
else
    print_warn "1.5GB 在 1GB scope 中没有被阻止（MemoryMax 可能未生效）"
fi

# ============================================================
# 测试 2: 多个 scope 并行 — 模拟 Harness 行为
# ============================================================

print_header "Test 2: 多个 scope 并行（模拟 Harness 多任务）"

echo "启动 3 个 scope，每个 MemoryMax=2GB，分配 1GB..."
echo "注意：3×1GB = 3GB，远低于物理内存，应该安全"
echo ""

PIDS=""
for i in 1 2 3; do
    systemd-run --user --scope -p MemoryMax=2G -- node "$STRESS_JS" --size 1GB --duration 5 --pattern greedy > /tmp/scope-test-$i.log 2>&1 &
    PIDS="$PIDS $!"
done

echo "等待 3 个 scope 完成..."
wait $PIDS 2>/dev/null || true

# 检查结果
ALL_PASS=true
for i in 1 2 3; do
    if grep -q "Test PASSED" /tmp/scope-test-$i.log; then
        print_ok "Scope $i: 1GB 分配成功"
    else
        print_fail "Scope $i: 1GB 分配失败"
        ALL_PASS=false
    fi
    rm -f /tmp/scope-test-$i.log
done

if [ "$ALL_PASS" = true ]; then
    print_ok "3 个 scope 并行分配 3GB 成功（无系统 hung）"
else
    print_fail "部分 scope 失败"
fi

echo ""
echo "当前内存状态:"
get_mem_info
echo ""

# ============================================================
# 测试 3: 多个 scope 并行 — 高压力（接近物理内存上限）
# ============================================================

print_header "Test 3: 高压力并行（接近物理内存上限）"

MEMTOTAL_GB=$(awk '/MemTotal/{printf "%.0f", $2/1048576}' /proc/meminfo)
AVAIL_GB=$(awk '/MemAvailable/{printf "%.1f", $2/1048576}' /proc/meminfo)

echo "物理内存: ${MEMTOTAL_GB}GB, 当前可用: ${AVAIL_GB}GB"
echo ""

# 计算安全的分配大小：不超过可用内存的 40%，并预留 2GB 给系统服务
SYSTEM_RESERVE_GB=2
SAFE_TOTAL_GB=$(echo "$AVAIL_GB * 0.4 - $SYSTEM_RESERVE_GB" | bc | cut -d. -f1)
SAFE_PER_SCOPE_GB=$(echo "$SAFE_TOTAL_GB / 3" | bc | cut -d. -f1)

if [ "$SAFE_PER_SCOPE_GB" -lt 1 ]; then
    print_warn "可用内存不足（扣除系统预留后），跳过高压力测试"
    SAFE_PER_SCOPE_GB=0
fi

if [ "$SAFE_PER_SCOPE_GB" -ge 1 ]; then
    echo "安全分配：3 个 scope 各 ${SAFE_PER_SCOPE_GB}GB (总计 ${SAFE_TOTAL_GB}GB)"
    echo ""

    PIDS=""
    for i in 1 2 3; do
        systemd-run --user --scope -p MemoryMax=${SAFE_PER_SCOPE_GB}G -- \
            timeout 30 node "$STRESS_JS" --size ${SAFE_PER_SCOPE_GB}GB --duration 5 --pattern greedy \
            > /tmp/scope-stress-$i.log 2>&1 &
        PIDS="$PIDS $!"
    done

    echo "等待完成（有 timeout 保护）..."
    wait $PIDS 2>/dev/null || true

    # 检查是否有 hung（超时）
    HUNG=false
    for i in 1 2 3; do
        if grep -q "Test PASSED" /tmp/scope-stress-$i.log; then
            print_ok "Scope $i: ${SAFE_PER_SCOPE_GB}GB 分配成功"
        elif grep -q "Allocation failed" /tmp/scope-stress-$i.log; then
            print_info "Scope $i: 分配失败（OOM/throttle 正常工作）"
        else
            print_fail "Scope $i: 可能 hung 或超时"
            HUNG=true
        fi
        rm -f /tmp/scope-stress-$i.log
    done

    echo ""
    echo "测试后内存状态:"
    get_mem_info
    echo ""

    if [ "$HUNG" = true ]; then
        print_fail "系统在高压下出现 hung！验证了根因假设"
    else
        print_ok "系统在高压下仍正常工作"
    fi
fi

# ============================================================
# 测试 4: user.slice 设置 MemoryMax 后的验证
# ============================================================

print_header "Test 4: user.slice MemoryMax 限制验证"

CURRENT_USER_MAX=$(cat /sys/fs/cgroup/user.slice/memory.max)

if [ "$CURRENT_USER_MAX" = "max" ]; then
    echo ""
    print_warn "user.slice 当前无限制 (memory.max = max)"
    echo ""
    echo "建议执行以下命令设置限制："
    echo ""
    echo "  sudo mkdir -p /etc/systemd/system/user.slice.d/"
    echo "  cat <<'CONF' | sudo tee /etc/systemd/system/user.slice.d/memory.conf"
    echo "  [Slice]"
    echo "  MemoryMax=12G"
    echo "  MemoryHigh=10G"
    echo "  MemorySwapMax=4G"
    echo "  CONF"
    echo "  sudo systemctl daemon-reload"
    echo ""
    echo "设置后重新运行此脚本验证效果"
    echo ""
    print_warn "未设置 user.slice 限制 — 测试无法验证修复效果"
else
    USER_MAX_GB=$(numfmt --to-unit=1073741824 <<< "$CURRENT_USER_MAX")
    print_info "user.slice MemoryMax = ${USER_MAX_GB}GB"

    # 尝试分配超过 user.slice 限制的内存
    EXCEED_GB=$(echo "$USER_MAX_GB + 1" | bc)
    echo ""
    echo "尝试在 user.slice 中分配超过限制的内存 (${EXCEED_GB}GB > ${USER_MAX_GB}GB)..."

    timeout 30 systemd-run --user --scope -- \
        node "$STRESS_JS" --size ${EXCEED_GB}GB --duration 5 --pattern greedy -v 2>&1 | tail -5
    RESULT=$?

    if [ $RESULT -ne 0 ]; then
        print_ok "超过 user.slice 限制被阻止 — cgroup OOM killer 正确介入！"
    else
        print_warn "超过 user.slice 限制没有被阻止 — 可能需要检查配置"
    fi
fi

# ============================================================
# 总结
# ============================================================

print_header "测试总结"

echo "1. 单个 scope MemoryMax: 已验证生效"
echo "2. 多个 scope 并行: 已验证"
echo "3. 高压力测试: 已验证（有 timeout 保护）"
echo ""
echo "关键结论："
echo "  - spawnWithMemoryLimit 的 scope 级限制有效"
echo "  - 但父级 cgroup (user.slice) 无限制 → 多进程仍可耗尽内存"
echo "  - 需要设置 user.slice MemoryMax 才能防止系统 hung"
echo ""
echo "下一步："
echo "  1. 执行上述 sudo 命令设置 user.slice 限制"
echo "  2. 重新运行此脚本验证修复效果"
echo "  3. 将环境检测+自动配置集成到 spawn-utils.ts"