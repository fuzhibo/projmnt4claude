---
description: "管理配置 (list/get/set)"
argument-hint: "<action> [key] [value]"
---

# config - 配置管理

管理项目的 `.projmnt4claude/config.json` 配置项。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js config <action> [key] [value]
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `list` | 列出所有配置项 | `config list` |
| `get` | 获取指定配置项的值 | `config get ai.provider` |
| `set` | 设置指定配置项的值 | `config set ai.provider custom-endpoint` |

## 常用配置项

| 配置项 | 说明 |
|--------|------|
| `projectName` | 项目名称 |
| `language` | 界面语言 (zh/en) |
| `ai.provider` | AI 提供者 (claude-code/custom-endpoint) |
| `ai.customEndpoint` | 自定义 AI 端点 URL |
| `logging.level` | 日志级别 (error/warn/info/debug) |
| `training.exportEnabled` | 是否启用训练数据导出 |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/config.md`
