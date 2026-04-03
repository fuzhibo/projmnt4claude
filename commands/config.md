---
description: "管理配置 (list/get/set)"
argument-hint: "<action> [key] [value]"
---

# 管理配置

管理项目的 `.projmnt4claude/config.json` 配置项。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js config <action> [key] [value]
```

## 操作说明

### list - 列出所有配置

列出当前项目的所有配置项及其值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js config list
```

### get - 获取配置值

获取指定配置项的值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js config get <key>
```

**参数:**
- `key` (必填) - 配置项名称

### set - 设置配置值

设置指定配置项的值。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js config set <key> <value>
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

## 配置项说明

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `projectName` | string | `""` | 项目名称 |
| `createdAt` | string | `""` | 初始化时间 (ISO 8601) |
| `branchPrefix` | string | `"task/"` | 任务分支前缀 |
| `defaultPriority` | string | `"medium"` | 默认优先级: low/medium/high/urgent |
| `language` | string | `"zh"` | 界面语言: zh/en |

### AI 配置 (`ai.*`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `ai.provider` | string | `"claude-code"` | AI 提供者标识 |
| `ai.providerOptions` | object | `{}` | 提供者专有配置（API 密钥、自定义端点等） |

**示例:**
```bash
# 设置 AI 提供者
config set ai.provider openai

# 设置自定义端点（通过 providerOptions）
config set ai.providerOptions '{"baseUrl": "https://api.example.com/v1"}'
```

### 日志配置 (`logging.*`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logging.level` | string | `"info"` | 日志级别: error/warn/info/debug |
| `logging.maxFiles` | number | `30` | 日志文件最大保留数量（按天轮转） |
| `logging.recordInputs` | boolean | `false` | 是否记录 AI 调用的输入内容 |
| `logging.inputMaxLength` | number | `1000` | 输入内容记录的最大字符长度 |

**示例:**
```bash
# 开启调试日志
config set logging.level debug

# 启用输入内容记录（用于调试 AI 行为）
config set logging.recordInputs true

# 限制记录长度
config set logging.inputMaxLength 500
```

### 训练数据配置 (`training.*`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `training.exportEnabled` | boolean | `false` | 是否启用训练数据导出 |
| `training.outputDir` | string | `".projmnt4claude/training"` | 导出目录路径 |

**示例:**
```bash
# 启用训练数据导出
config set training.exportEnabled true

# 设置自定义导出路径
config set training.outputDir "./training-data"
```

## 使用场景

- 查看项目当前配置
- 修改项目配置项（如语言、默认设置等）
- 脚本化配置管理
- 调整日志级别进行问题排查
- 配置 AI 提供者用于增强分析
- 启用训练数据收集

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. 配置存储在 `.projmnt4claude/config.json` 中
3. `set` 操作会直接修改配置文件，请谨慎操作
4. 嵌套配置项使用点号分隔访问，如 `ai.provider`
5. 复杂值（对象、数组）需要使用 JSON 格式字符串
