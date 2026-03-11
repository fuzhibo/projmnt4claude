---
description: "从自然语言需求描述创建任务 - 必须让CLI完成整个创建流程，确保任务持久化到.projmnt4claude目录"
argument-hint: "<description>"
---

# 自然语言需求初始化

从自然语言描述自动分析并创建任务。

## ⚠️ 重要：任务持久化要求

**此命令必须完成整个交互式流程，确保任务被持久化到 `.projmnt4claude/tasks/` 目录。**

执行此命令后：
1. CLI 会显示需求分析结果
2. CLI 会询问用户确认
3. CLI 会创建任务文件（meta.json 和 checkpoint.md）
4. CLI 会询问是否添加到执行计划

**禁止行为**：
- ❌ 不要在获取分析结果后直接在上下文中规划执行
- ❌ 不要跳过 CLI 的交互式确认步骤

**正确行为**：
- ✅ 让 CLI 完成整个创建流程
- ✅ 创建完成后，可从 `.projmnt4claude/tasks/` 读取任务信息
- ✅ 如果上下文丢失，可从 `.projmnt4claude` 恢复项目状态

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "<需求描述>"
```

## 功能

- 自动检测优先级（紧急/重要/低）
- 自动识别推荐角色（前端/后端/测试等）
- 估算任务复杂度
- 生成建议检查点
- 识别潜在依赖

## 示例

```bash
# 创建 API 任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "实现一个用户登录API接口，需要高优先级处理"

# 创建前端任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "设计并实现用户个人中心页面，包含头像上传和资料编辑"

# 创建测试任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "为认证模块编写单元测试和集成测试"
```

## 关键词识别

### 优先级关键词
- 紧急/urgent/asap/立即 → urgent
- 重要/important/优先/high → high
- 低优先级/可选/optional → low

### 角色关键词
- UI/界面/前端/frontend → frontend
- API/后端/backend/服务端 → backend
- 测试/test/qa → qa
- 文档/document/readme → writer
- 安全/security/漏洞 → security
- 性能/performance/优化 → performance
