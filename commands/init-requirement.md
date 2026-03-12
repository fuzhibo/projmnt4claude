---
description: "从自然语言需求描述创建任务 - 必须让CLI完成整个创建流程，确保任务持久化到.projmnt4claude目录"
argument-hint: "<description>"
---

# 自然语言需求初始化

从自然语言描述自动分析并创建任务。

## ⚠️ 重要：任务持久化要求

**此命令必须完成整个流程，确保任务被持久化到 `.projmnt4claude/tasks/` 目录。**

执行此命令后：
1. CLI 会显示需求分析结果
2. CLI 会询问用户确认（非交互模式自动确认）
3. CLI 会创建任务文件（meta.json 和 checkpoint.md）
4. CLI 会询问是否添加到执行计划（非交互模式跳过）

## 执行方式

### 交互模式（默认）
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement "<需求描述>"
```

### 非交互模式（推荐 AI 使用）
```bash
# 使用 -y 或 --yes 跳过所有确认
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "<需求描述>"

# 同时跳过添加到计划的询问
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --no-plan "<需求描述>"
```

## 命令选项

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认，直接使用分析结果创建任务 |
| `--no-plan` | 创建任务后不询问是否添加到执行计划 |

## 功能

- 自动检测优先级（紧急/重要/低）
- 自动识别推荐角色（前端/后端/测试等）
- 估算任务复杂度
- 生成建议检查点
- 识别潜在依赖
- **非交互模式支持**：适合 AI 自动化调用

## 示例

```bash
# 创建 API 任务（非交互模式）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "实现一个用户登录API接口，需要高优先级处理"

# 创建前端任务（非交互模式）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "设计并实现用户个人中心页面，包含头像上传和资料编辑"

# 创建测试任务
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "为认证模块编写单元测试和集成测试"
```

## 关键词识别

### 优先级关键词
- 紧急/urgent/asap/立即 → P0
- 重要/important/优先/high → P1
- 中等/medium/默认 → P2
- 低优先级/可选/optional → P3

### 角色关键词
- UI/界面/前端/frontend → frontend
- API/后端/backend/服务端 → backend
- 测试/test/qa → qa
- 文档/document/readme → writer
- 安全/security/漏洞 → security
- 性能/performance/优化 → performance
