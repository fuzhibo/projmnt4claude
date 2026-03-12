---
description: "初始化项目管理环境 - 创建 .projmnt4claude 目录结构"
argument-hint: "[-y] [--language <zh|en>]"
---

# 初始化项目管理环境

在当前项目根目录初始化项目管理环境。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js setup
```

## 选项

| 选项 | 描述 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认，使用默认设置 |
| `-l, --language <zh\|en>` | 指定语言 (中文/English) |

## 功能说明

此命令将在用户项目根目录创建 `.projmnt4claude/` 目录结构：

```
.projmnt4claude/
├── config.json          # 项目配置
├── tasks/               # 任务目录
├── archive/             # 归档任务
├── toolbox/             # 本地 skill
├── hooks/               # 钩子脚本
└── reports/             # 分析报告
```

## 使用场景

- 首次在项目中使用 projmnt4claude 时
- 需要重置项目管理环境时
- **AI 自动初始化时** (使用 `-y` 跳过交互)

## AI 使用建议

当 AI 需要自动初始化项目时，应使用非交互模式:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js setup -y
```

或指定语言:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js setup -y --language en
```

## 注意事项

1. 如果 `.projmnt4claude/` 目录已存在，会提示是否覆盖
2. 初始化后可以使用所有任务管理功能
3. 非交互模式下默认使用中文
