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
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze --fix -y
```

## 选项

| 选项 | 描述 | 默认值 | 推荐场景 |
|------|------|--------|----------|
| `--fix` | 自动修复所有可修复的问题（schema 迁移、废弃状态、字段完整性等） | - | 用户/AI |
| `--fix-checkpoints` | 智能生成缺失的检查点 | - | 用户/AI |
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
- 无效依赖引用
- 状态矛盾（resolved 但 verification.failed）
- **废弃状态检测**（reopened/needs_human，v4 已废弃）
- **字段完整性**（transitionNotes 未初始化等）
- Manual 验证方法（已弃用）

## 修复操作

### --fix（综合修复）
- 将孤立任务移入归档
- 将过期任务标记为 abandoned
- 修复旧格式优先级/状态
- 修复无效依赖引用
- 修复状态矛盾
- 修复 schema 版本
- **迁移废弃状态**: reopened → open（通过 reopenCount 追踪）、needs_human → open（通过 resumeAction 追踪）
- **补全缺失字段**: transitionNotes、schemaVersion 等 v4+ 必需字段初始化
- 清理历史记录中对废弃状态的引用

### --fix-checkpoints（检查点生成）
- 智能分析验收标准并搜索代码库
- 为缺少检查点的任务生成精确的检查点
- 使用 `--task <taskId>` 可针对单个任务操作

### --quality-check（质量检测）
- 描述完整度评分 (35% 权重)
- 检查点质量评分 (30% 权重)
- 关联文件评分 (15% 权重)
- 解决方案评分 (20% 权重)

## 有效任务状态

| 状态 | 说明 |
|------|------|
| `open` | 待处理（包含重开的任务，通过 reopenCount 追踪） |
| `in_progress` | 正在执行 |
| `wait_review` | 等待代码审查（pipeline 中间状态） |
| `wait_qa` | 等待 QA 验证（pipeline 中间状态） |
| `wait_complete` | 等待完成确认（pipeline 中间状态） |
| `resolved` | 任务已完成并验证通过 |
| `closed` | 任务已关闭（终态） |
| `abandoned` | 任务已放弃（终态） |

> **注意**: `reopened` 和 `needs_human` 在 schema v4 中已废弃。原使用这些状态的任务会迁移为 `open`，并通过 reopenCount、resumeAction、transitionNotes 等字段追踪。

### 人工验证后置处理

完成人工验证检查点后：
1. 运行 `analyze --fix -y` 同步所有检测到的问题
2. 运行 `doctor --fix` 验证项目级健康状态
3. `--fix` 会自动处理废弃状态清理和字段迁移
