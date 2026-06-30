---
description: "初始化项目管理环境 - 创建 .projmnt4claude 目录结构"
argument-hint: "[-y] [--language <zh|en>]"
---

# setup - 初始化项目管理环境

在当前项目根目录初始化项目管理环境，创建 `.projmnt4claude/` 目录结构。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js setup [options]
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认，使用默认设置 |
| `-l, --language <zh\|en>` | 指定语言 (中文/English) |
| `-f, --force` | 强制重新初始化（重新复制技能文件） |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/setup.md`
