---
description: "运行环境诊断，检查并修复设置问题"
argument-hint: "[--fix] [--bug-report]"
---

# 环境诊断命令

运行环境诊断，检查 projmnt4claude 设置问题并可选修复。

## 执行方式

```bash
# 仅诊断
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js doctor

# 诊断并自动修复
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js doctor --fix

# 生成 Bug 报告
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js doctor --bug-report
```

## 选项

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `--fix` | 自动修复检测到的问题，修复后自动重新检查 | false |
| `--bug-report` | 生成 Bug 报告（含日志压缩附件、AI 成本汇总、使用分析） | false |

## 检测项目

| 检测项 | 说明 | 可修复 |
|--------|------|--------|
| 项目初始化 | 检查 `.projmnt4claude/config.json` 是否存在 | 否 |
| 插件安装作用域 | 检测 project-scope 安装导致的跨项目更新问题 | 否 |
| 插件缓存 | 检查主程序文件、语言包、slash commands 是否完整 | 否 |
| 命令文档 | 检查 skills 目录下命令文档是否安装 | 是 |
| 任务命名格式 | 检查任务 ID 是否符合规范格式 | 否 |
| 任务类型一致性 | 检查任务 ID 类型与 meta.json 是否匹配 | 否 |
| 目录结构 | 检查 tasks、toolbox、archive 目录是否存在 | 是 |
| Hooks 配置 | 检查 hooks 目录、hook 文件、settings.json 配置完整性 | 是 |
| 任务规范对齐 | 检查任务 meta.json 是否包含最新规范字段 (reopenCount, requirementHistory) | 是 |

## --bug-report（Bug 报告生成）

生成包含以下内容的综合 Bug 报告：

### 报告内容
- **Markdown 报告**: 最近日志条目摘要（默认最近 100 条）
- **日志压缩附件**: `.tar.gz` 格式的完整日志归档
- **AI 成本汇总**: 总调用次数、耗时、Token 用量、按字段分组统计
- **使用分析**: 命令执行频率、平均耗时、AI 使用率、常见错误

### 适用场景
- 提交 Bug 报告时附上诊断信息
- 分析 AI 使用成本和效率
- 排查命令执行问题
- 项目健康状态审查

### 输出示例
```
📋 Bug 报告生成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Markdown 报告内容]

💰 AI 成本汇总
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总 AI 调用次数: 42
总耗时: 128.5s
总 Tokens: 52340 (输入: 31200, 输出: 21140)

按字段分组:
  enhanceRequirement: 15 次调用, 45.2s, 18200 tokens
  analyzeTask: 27 次调用, 83.3s, 34140 tokens

📊 使用分析
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总命令执行次数: 156
平均耗时: 3.2s
AI 使用率: 78.5%
错误数: 3, 警告数: 12

命令使用频率:
  init-requirement: 45 次
  analyze: 32 次
  task list: 28 次

📎 日志压缩附件: .projmnt4claude/logs/bug-report-20260404.tar.gz
```

## --fix（自动修复）

启用 `--fix` 后，doctor 会自动修复以下问题：
1. 创建缺失的目录（tasks、toolbox、archive、hooks）
2. 重新复制技能文件和命令文档
3. 创建缺失的 Hook 模板文件
4. 配置 `.claude/settings.json` 中的 hooks

修复完成后会自动重新运行诊断以验证修复效果。

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. `--fix` 和 `--bug-report` 不应同时使用
3. Bug 报告中的日志压缩附件可能包含敏感信息，分享前请检查
