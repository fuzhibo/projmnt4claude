---
description: "管理配置 (list/get/set)"
argument-hint: "<action> [key] [value]"
---

# 管理配置

管理项目的 `.projmnt4claude/config.json` 配置项。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js config <action> [key] [value]
```

## 操作说明

### list - 列出所有配置

列出当前项目的所有配置项及其值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js config list
```

### get - 获取配置值

获取指定配置项的值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js config get <key>
```

**参数:**
- `key` (必填) - 配置项名称

### set - 设置配置值

设置指定配置项的值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js config set <key> <value>
```

**参数:**
- `key` (必填) - 配置项名称
- `value` (必填) - 配置项值

## 支持的操作

| 操作 | 描述 | 必填参数 |
|------|------|----------|
| `list` | 列出所有配置项 | 无 |
| `get` | 获取指定配置项的值 | `key` |
| `set` | 设置指定配置项的值 | `key`, `value` |

## 使用场景

- 查看项目当前配置
- 修改项目配置项（如语言、默认设置等）
- 脚本化配置管理

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. 配置存储在 `.projmnt4claude/config.json` 中
3. `set` 操作会直接修改配置文件，请谨慎操作
