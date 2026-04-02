---
description: "从自然语言需求描述创建任务 - 必须让CLI完成整个创建流程，确保任务持久化到.projmnt4claude目录"
argument-hint: "<description>"
---

# init-requirement - 自然语言需求创建任务

从自然语言描述自动分析并创建结构化任务。无需手动填写表单，一句话即可完成需求到任务的转换。

## 重要：任务持久化要求

**此命令必须完成整个流程，确保任务被持久化到 `.projmnt4claude/tasks/` 目录。**

执行此命令后：
1. CLI 会显示需求分析结果（自动提取优先级、角色、复杂度、检查点）
2. CLI 会询问用户确认（非交互模式自动确认）
3. CLI 会创建任务文件（meta.json 和 checkpoint.md）
4. CLI 会询问是否添加到执行计划（非交互模式跳过）

**禁止行为**：
- 不要在获取分析结果后直接在上下文中规划执行
- 不要跳过 CLI 的交互式确认步骤

**正确行为**：
- 让 CLI 完成整个创建流程
- 创建完成后，可从 `.projmnt4claude/tasks/` 读取任务信息

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
交互模式会逐步引导你确认分析结果、编辑标题/描述/优先级/角色，并选择是否添加到执行计划。

### 非交互模式（推荐 AI 使用）
```bash
# 使用 -y 或 --yes 跳过所有确认，直接使用分析结果创建任务
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

## 自动分析功能

| 分析维度 | 说明 | 示例关键词 |
|----------|------|-----------|
| 优先级 | P0-P3 四级 | 紧急→P0, 重要→P1, 可选→P3 |
| 推荐角色 | 匹配最佳执行角色 | UI→frontend, API→backend |
| 复杂度 | low/medium/high | 重构→high, 修复→low |
| 检查点 | 根据任务类型生成 | API任务→设计/实现/文档/测试 |
| 依赖 | 识别潜在依赖 | 登录→依赖认证基础功能 |

## 使用示例

### 创建 API 任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "实现一个用户登录API接口，需要高优先级处理"
```
自动识别为：优先级 P1（高）、推荐角色 backend、检查点含 API 设计/实现/文档/测试。

### 创建前端任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "设计并实现用户个人中心页面，包含头像上传和资料编辑"
```
自动识别为：推荐角色 frontend、检查点含 UI 原型/组件/交互/响应式。

### 创建紧急修复任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "紧急修复线上支付接口超时问题"
```
自动识别为：优先级 P0（紧急）、推荐角色 backend。

### 创建测试任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "为认证模块编写单元测试和集成测试"
```
自动识别为：推荐角色 qa、检查点含单元测试/集成测试/覆盖率。

### 创建文档任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "为 API 模块编写使用文档"
```
自动识别为：推荐角色 writer、检查点含收集需求/编写内容/审核。

### 创建安全任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "修复用户输入未做 XSS 过滤的安全漏洞"
```
自动识别为：推荐角色 security、复杂度 medium。

### 创建数据库任务
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement -y "设计并创建用户表的数据库迁移脚本"
```
自动识别为：检查点含数据模型/迁移/数据访问层。

### 交互模式创建（人工编辑每个字段）
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "重构认证模块架构，需要支持多租户"
```
交互模式会让你确认并修改标题、描述、优先级和角色。

## 关键词识别参考

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

## 创建后的任务结构

```
.projmnt4claude/tasks/{TASK-ID}/
├── meta.json        # 任务元数据（标题、优先级、角色、检查点等）
└── checkpoint.md    # 检查点清单（markdown 格式）
```

任务 ID 格式：`{type}-{priority}-{序号}-{关键词}`，如 `bugfix-P0-001-fix-payment-timeout`。

## 常见问题

**Q: 提示"项目未初始化"怎么办？**
A: 先运行 `projmnt4claude setup` 初始化项目管理目录。

**Q: 分析结果不准确怎么办？**
A: 在交互模式下可以手动编辑每个字段。非交互模式下可以之后用 `task update` 修改。

**Q: 如何查看已创建的任务？**
A: 运行 `projmnt4claude task list` 查看所有任务。

**Q: 如何修改已创建任务的优先级？**
A: 运行 `projmnt4claude task update <taskId> --priority P1`。
