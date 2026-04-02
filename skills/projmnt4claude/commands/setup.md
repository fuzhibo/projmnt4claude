---
description: "初始化项目管理环境 - 创建 .projmnt4claude 目录结构"
argument-hint: ""
---

# 初始化项目管理环境

在当前项目根目录初始化项目管理环境。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js setup
```

## 选项

| 选项 | 描述 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认，使用默认设置 |
| `-l, --language <zh\|en>` | 指定语言 (中文/English) |
| `-f, --force` | 强制重新初始化（重新复制技能文件） |

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

## 注意事项

1. 如果 `.projmnt4claude/` 目录已存在，会提示是否覆盖
2. 初始化后可以使用所有任务管理功能
