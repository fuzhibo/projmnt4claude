# 开发报告：batch-update 命令安全增强

**任务ID**: TASK-research-P2-batch-update-tracking-20260414  
**日期**: 2026-04-15  
**开发者**: Claude Code

---

## 任务概述

调查 2026-04-14 发生的 7 个已解决任务被错误重新打开的问题，并为 `batch-update` 命令添加详细日志记录和安全增强。

---

## 调查结果

### 已完成的调查

1. **日志系统已存在** - `src/utils/batch-update-logger.ts` 已实现完整的日志记录功能
2. **日志记录内容**:
   - 时间戳 (ISO 8601)
   - 操作来源 (CLI/IDE/Hook/Script)
   - 命令行参数
   - 任务变更详情 (ID, 标题, 旧状态, 新状态)
   - 执行上下文 (PID, PPID, 工作目录, 环境指示器)
   - 调用栈追踪
   - 进程运行时间
   - 完整命令行

3. **问题根因** - 最可能是 `batch-update --all --status open` 命令被误触发
   - `--all` 选项会包含已解决/已关闭的任务
   - 配合 `--yes` 跳过了确认提示

---

## 实施的增强

### 1. 安全增强 (`src/commands/task.ts`)

#### 新增功能：
- **特别警告 `--all` 选项** - 当使用 `--all` 时会显示额外警告
- **强制二次确认** - 对于以下情况，即使使用 `--yes` 也需要额外确认：
  - 使用了 `--all` 选项
  - 重开任务数量 >= 5

#### 代码变更：
```typescript
// 检测是否使用了 --all 选项
const isUsingAllFlag = options.all === true;
const highRiskCount = reopeningTasks.length;

// 特别警告 --all 选项的使用
if (isUsingAllFlag) {
  console.log('🚨 使用了 --all 选项');
  console.log('   这会导致包含所有已解决/已关闭的任务');
}

// 对 --all 选项或大量重开操作，强制要求额外确认（即使使用了 --yes）
if ((isUsingAllFlag || highRiskCount >= 5) && options.yes) {
  const extraConfirm = await prompts({...});
}
```

---

## 验证结果

### 测试状态
- ✅ `batch-update-logger.test.ts` - 15 个测试全部通过
- ✅ `task.test.ts` - 61 个测试全部通过
- ✅ 构建成功 - 无 TypeScript 错误

### 日志文件位置
```
.projmnt4claude/logs/batch-update-YYYY-MM-DD.log
```

### 日志查询命令
```bash
# 查看今天的日志
projmnt4claude task batch-update-logs

# 查看统计摘要
projmnt4claude task batch-update-logs --summary

# 按来源过滤
projmnt4claude task batch-update-logs --source ide
```

---

## 建议的后续措施

1. **监控日志** - 定期查看 `batch-update-logs` 识别异常模式
2. **培训用户** - 提醒团队关于 `--all` 选项的风险
3. **IDE 插件审查** - 检查是否有 IDE 插件可能自动触发命令
4. **快捷键审查** - 检查终端/IDE 快捷键配置

---

## 相关文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/commands/task.ts` | 修改 | 增强 batchUpdateTasks 安全机制 |
| `src/utils/batch-update-logger.ts` | 已存在 | 完整日志记录系统 |
| `src/utils/__tests__/batch-update-logger.test.ts` | 已存在 | 测试覆盖 |

---

## 结论

`batch-update` 命令已具备完善的日志记录功能。本次增强添加了针对 `--all` 选项的额外安全保护，防止意外批量重开已解决的任务。如果问题再次发生，可以通过日志确定触发来源和上下文。
