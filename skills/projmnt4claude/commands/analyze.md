---
description: "分析项目健康状态并可选修复问题"
argument-hint: "[--fix]"
---

# 项目分析命令

分析项目健康状态，检测并修复问题。

## 执行方式

```bash
# 仅分析
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze

# 分析并修复
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze --fix
```

## 选项

| 选项 | 描述 | 默认值 | 推荐场景 |
|------|------|--------|----------|
| `--fix` | 自动修复所有可修复的问题 | - | 用户/AI |
| `--fix-checkpoints` | 智能生成缺失的检查点 | - | 用户/AI |
| `--fix-verification` | 仅修复验证方法问题 (manual -> automated) | - | AI |
| `--fix-status` | 仅修复状态相关问题 (状态格式、优先级、时间戳等) | - | AI |
| `--quality-check` | 检测任务内容质量（描述完整度、检查点质量、关联文件、解决方案） | - | 用户/AI |
| `--threshold <score>` | 质量检测阈值，低于此分数的任务将被标记 | 60 | 用户/AI |
| `-j, --json` | JSON 格式输出 (仅 --quality-check) | false | AI |
| `-y, --yes` | 非交互模式：自动修复可修复的问题 | false | AI |
| `--compact` | 使用简洁分隔符 | false | AI |
| `--task <taskId>` | 指定任务ID (仅 --fix-checkpoints) | - | AI |

## 检测项目

- 孤立任务（无依赖且无人处理）
- 循环依赖
- 状态异常的任务
- 长期未更新的任务
- 相似任务（可合并建议）
- 缺失检查点的任务
- 配置问题
- Schema 版本过时
- 无效依赖/父任务引用
- Manual 验证方法（已弃用）

## 修复操作

### --fix（综合修复）
- 将孤立任务移入归档
- 将过期任务标记为 abandoned
- 修复旧格式优先级/状态
- 修复无效依赖引用
- 修复状态矛盾 (resolved + verification.failed)
- 修复 schema 版本过时

### --fix-checkpoints（检查点生成）
- 智能分析验收标准并搜索代码库
- 为缺少检查点的任务生成精确的检查点
- 使用 `--task <taskId>` 可针对单个任务操作

### --fix-verification（验证方法修复）
- 将 manual 验证方法替换为 automated
- 为 resolved 但缺少 verification 的任务回填字段

### --fix-status（状态修复）
- 修复旧格式状态 (pending/completed/reopen/cancelled)
- 修复旧格式优先级 (urgent/high/medium/low)
- 修复 pipeline 中间状态迁移
- 修复时间戳格式

### --quality-check（质量检测）
- 描述完整度评分 (35% 权重)
- 检查点质量评分 (30% 权重)
- 关联文件评分 (15% 权重)
- 解决方案评分 (20% 权重)
- 使用 `--threshold` 设置低质量阈值 (默认 60)
