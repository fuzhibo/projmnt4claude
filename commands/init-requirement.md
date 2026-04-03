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
2. CLI 会询问用户确认
3. CLI 会创建任务文件（meta.json 和 checkpoint.md）
4. CLI 会询问是否添加到执行计划

**禁止行为**：
- 不要在获取分析结果后直接在上下文中规划执行
- 不要跳过 CLI 的交互式确认步骤

**正确行为**：
- 让 CLI 完成整个创建流程
- 创建完成后，可从 `.projmnt4claude/tasks/` 读取任务信息
- 如果上下文丢失，可从 `.projmnt4claude` 恢复项目状态

## 前提条件

运行此命令前，需要先初始化项目：
```bash
projmnt4claude setup
```

## 执行方式

### 交互模式（默认，适合人工使用）
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "<需求描述>"
```

### 非交互模式（推荐 AI 使用）
```bash
# 使用 -y 或 --yes 跳过所有确认
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "<需求描述>"

# 同时跳过添加到计划的询问
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y --no-plan "<需求描述>"

# 跳过 checkpoint 质量校验
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y --skip-validation "<需求描述>"
```

## 命令选项

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认，直接使用分析结果创建任务 |
| `--no-plan` | 创建任务后不询问是否添加到执行计划 |
| `--skip-validation` | 跳过 checkpoint 质量校验（不推荐） |
| `--template <type>` | 描述模板类型: simple (默认) 或 detailed (详细结构化) |
| `--auto-split` | 自动拆分复杂任务为子任务（复杂度评估为 high 时生效） |
| `--no-ai` | 禁用 AI 增强，仅使用规则引擎分析 |

## AI 增强行为

### 默认启用
`init-requirement` 默认启用 AI 增强，在规则引擎分析后额外调用 AI 进行需求优化：
- **标题优化**: AI 生成的标题如果长度在 10-50 字符之间则采用
- **优先级修正**: AI 可修正基于关键词推断的优先级
- **角色推荐**: AI 根据语义理解推荐更合适的执行角色
- **检查点增强**: AI 生成更精确的检查点，与规则引擎检查点合并去重
- **依赖识别**: AI 识别规则引擎未覆盖的潜在依赖

### 回退机制
当 AI 调用失败（网络错误、API 不可用等）时，自动回退到纯规则引擎结果，不会阻断任务创建流程。

### 禁用 AI
使用 `--no-ai` 可禁用所有 AI 功能，仅使用规则引擎进行关键词匹配分析。适用于离线环境或不需要 AI 增强的场景。

### AI 增强标识
分析结果中 AI 增强的字段会标注 `(AI enhanced)` 标记，方便用户区分来源。

## 自动分析功能

| 分析维度 | 说明 | 示例关键词 |
|----------|------|-----------|
| 优先级 | P0-P3 四级 | 紧急→P0, 重要→P1, 可选→P3 |
| 推荐角色 | 匹配最佳执行角色 | UI→frontend, API→backend |
| 复杂度 | low/medium/high | 重构→high, 修复→low |
| 检查点 | 根据任务类型生成 | API任务→设计/实现/文档/测试 |
| 依赖 | 识别潜在依赖 | 登录→依赖认证基础功能 |

## 使用示例

```bash
# 创建 API 任务（非交互模式）
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "实现一个用户登录API接口，需要高优先级处理"

# 创建前端任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "设计并实现用户个人中心页面，包含头像上传和资料编辑"

# 创建紧急修复任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "紧急修复线上支付接口超时问题"

# 创建测试任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "为认证模块编写单元测试和集成测试"

# 创建文档任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "为 API 模块编写使用文档"

# 创建安全任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "修复用户输入未做 XSS 过滤的安全漏洞"

# 创建数据库任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "设计并创建用户表的数据库迁移脚本"

# 禁用 AI 增强（仅规则引擎分析）
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y --no-ai "重构认证模块架构"
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
- 架构/architecture/设计 → architect

### 复杂度关键词
- 重构/refactor/架构/迁移/集成/系统 → high
- 修复/fix/更新/添加/修改/调整 → low
- 其他 → medium（默认）

## 常见问题

**Q: 提示"项目未初始化"怎么办？**
A: 先运行 `projmnt4claude setup` 初始化项目管理目录。

**Q: 分析结果不准确怎么办？**
A: 在交互模式下可以手动编辑每个字段。非交互模式下可以之后用 `task update` 修改。

**Q: 如何查看已创建的任务？**
A: 运行 `projmnt4claude task list` 查看所有任务。

**Q: 如何修改已创建任务的优先级？**
A: 运行 `projmnt4claude task update <taskId> --priority P1`。
