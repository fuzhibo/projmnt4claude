/**
 * 提示词模板系统
 *
 * 提供类型定义、模板插值、默认模板常量和配置加载机制。
 * 支持通过 config.json 的 prompts 配置节自定义提示词模板。
 */

import { readConfig } from '../commands/config.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 模板变量类型
 *
 * 键为变量名（对应模板中的 {variableName}），值为字符串或数字。
 * 值为 undefined 的键不会替换模板中的占位符。
 */
export type TemplateVariables = Record<string, string | number | undefined>;

/**
 * 提示词模板类型
 *
 * 使用 {variableName} 占位符的字符串模板。
 * 调用 resolveTemplate() 将占位符替换为实际值。
 */
export type PromptTemplate = string;

/**
 * 已知提示词模板名称
 *
 * 对应 11 个硬编码提示词构建点（见 investigation-report-20260407/15）。
 */
export type PromptTemplateName =
  | 'dev'
  | 'codeReview'
  | 'qa'
  | 'evaluation'
  | 'requirement'
  | 'checkpoints'
  | 'quality'
  | 'duplicates'
  | 'staleness'
  | 'bugReport'
  | 'semanticDependency';

/** 所有已知模板名称列表 */
export const PROMPT_TEMPLATE_NAMES: PromptTemplateName[] = [
  'dev',
  'codeReview',
  'qa',
  'evaluation',
  'requirement',
  'checkpoints',
  'quality',
  'duplicates',
  'staleness',
  'bugReport',
  'semanticDependency',
];

// ============================================================
// resolveTemplate - 模板插值函数
// ============================================================

/**
 * 将模板中的 {variableName} 占位符替换为实际值。
 *
 * - 未提供的变量保留原始占位符（不删除）
 * - 支持 string 和 number 类型的值
 * - 不递归替换（避免注入循环）
 *
 * @param template - 含 {variable} 占位符的模板字符串
 * @param variables - 变量名到值的映射
 * @returns 替换后的字符串
 *
 * @example
 * resolveTemplate('{taskId} - {title}', {taskId: 'T1', title: '测试'})
 * // => 'T1 - 测试'
 */
export function resolveTemplate(template: PromptTemplate, variables: TemplateVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return match;
    }
    return String(value);
  });
}

// ============================================================
// 默认模板常量（从代码中提取，保持原文本）
// ============================================================

/**
 * 开发阶段默认模板
 * @source harness-executor.ts buildDevPrompt()
 */
export const DEFAULT_DEV_TEMPLATE: PromptTemplate = `# 任务: {title}

## 任务ID: {taskId}
## 类型: {type}
## 优先级: {priority}
{timeoutHeader}
{descriptionSection}
{dependenciesSection}
{acceptanceCriteriaSection}
{checkpointsSection}
## 指示
{timeoutInstruction}
1. 仔细阅读任务描述和验收标准
2. 实现所需的功能或修复
3. 确保代码符合项目规范
4. 运行必要的测试验证实现
5. 完成后简要总结所做的更改

{extraInstructionsSection}
## ⛔ 禁止操作（严格遵守）
{roleDeclaration}以下操作被严格禁止：

1. **禁止创建新任务** - 不要运行 \`task create\`、\`init-requirement\` 或任何创建任务的命令
2. **禁止修改任务元数据** - 不要修改 \`.projmnt4claude/tasks/\` 下的 meta.json 文件
3. **禁止创建子任务** - 不要将当前任务拆分为多个子任务并尝试创建它们

如果任务确实需要拆分，请在开发报告中 **建议** 拆分方案，由人工决定是否创建新任务。
违反以上任何禁令将导致评估不通过。`;

/**
 * 代码审核阶段默认模板
 * @source harness-code-reviewer.ts buildCodeReviewPrompt()
 */
export const DEFAULT_CODE_REVIEW_TEMPLATE: PromptTemplate = `# 代码审核任务

{roleDeclaration}你需要审核一个任务的代码实现，确保代码质量符合标准。

**重要**: 你必须严格审核，发现所有代码质量问题。

{retryContextSection}## 任务信息
- ID: {taskId}
- 标题: {title}
{descriptionSection}
## 代码审核检查点
{checkpointsList}
{changesSection}
{evidenceSection}
## 审核要求
{reviewFocus}
## 输出格式
请按以下格式输出审核结果:
\`\`\`
VERDICT: PASS 或 VERDICT: NOPASS
## 审核结果: PASS 或 NOPASS
## 原因: [简要说明为什么通过或不通过]
## 代码质量问题: [列出发现的问题，如果没有则为空]
## 未通过的检查点: [列出未通过的检查点ID，如果没有则为空]
## 详细反馈: [可选的详细反馈]
\`\`\`

**重要**: 必须输出 VERDICT: PASS 或 VERDICT: NOPASS，不得使用"通过"、"不通过"等中文词语。

现在开始审核。`;

/**
 * QA 验证阶段默认模板
 * @source harness-qa-tester.ts buildQAPrompt()
 */
export const DEFAULT_QA_TEMPLATE: PromptTemplate = `# QA 验证任务

{roleDeclaration}你需要验证一个任务的实现是否满足功能要求。

**重要**: 你必须严格验证，确保所有功能正常工作。

## 验证原则

请遵循以下原则进行验证：

1. **功能优先**: 验证的核心是功能是否正确实现，而非实现形式。
   - 内联函数与类方法在功能等价时应视为通过。例如：如果任务要求创建一个类方法，但实现使用了功能等价的内联函数/导出函数，只要功能正确就应通过。
   - 不要因为代码组织方式（如使用独立函数代替类方法）而判定为不通过，除非任务明确要求特定的实现结构。

2. **解析伪影识别**: 忽略由自然语言描述算法步骤时产生的结构要求。
   - 任务描述中的"创建类"、"定义接口"等措辞可能是算法描述的产物，不构成实际的代码结构要求。
   - 如果代码通过不同结构（如模块级函数代替类方法）实现了相同功能，应视为满足要求。

{retryContextSection}
## 任务信息
- ID: {taskId}
- 标题: {title}
{descriptionSection}
## QA 验证检查点
{checkpointsList}
## 代码审核结果
- 结果: {codeReviewResult}
- 原因: {codeReviewReason}

## 验证要求
{testStrategy}
## 输出格式
请按以下格式输出验证结果:

\`\`\`
VERDICT: PASS 或 VERDICT: NOPASS
## 验证结果: PASS 或 NOPASS
## 原因: [简要说明为什么通过或不通过]
## 测试失败: [列出失败的测试，如果没有则为空]
## 未通过的检查点: [列出未通过的检查点ID，如果没有则为空]
## 详细反馈: [可选的详细反馈]
\`\`\`

**重要格式要求**:
- 必须输出 VERDICT: PASS 或 VERDICT: NOPASS 标记行
- 不得使用"通过"、"不通过"等中文词语
- 所有检查点都通过时，必须输出 PASS
- 有任何检查点失败时，必须输出 NOPASS

**VERDICT 判定规则**:
- **PASS**: 必须同时满足以下所有条件：
  1. 所有自动化检查点验证通过
  2. 没有测试失败
  3. 功能符合预期
  4. 代码审核结果为 PASS
- **NOPASS**: 满足以下任一条件即判定为 NOPASS：
  1. 存在任何测试失败
  2. 任何检查点未通过
  3. 功能不符合预期
  4. 代码审核结果为 NOPASS

**格式说明**:
| 字段 | 说明 | 必填 |
|------|------|------|
| VERDICT: | 只能是 PASS 或 NOPASS | 是 |
| ## 验证结果: | 与 VERDICT 一致 | 是 |
| ## 原因: | 简明说明判定理由（1-2句话） | 是 |
| ## 测试失败: | 列出具体失败测试，PASS 时留空或用"无" | 是 |
| ## 未通过的检查点: | 列出失败检查点ID，PASS 时留空或用"无" | 是 |
| ## 详细反馈: | 可选的补充说明 | 否 |

**正确示例（通过）**:
\`\`\`
VERDICT: PASS
## 验证结果: PASS
## 原因: 所有功能测试通过，检查点验证完成
## 测试失败:
## 未通过的检查点:
## 详细反馈: 实现符合需求，功能正确。
\`\`\`

**正确示例（通过 - 简洁版）**:
\`\`\`
VERDICT: PASS
## 验证结果: PASS
## 原因: 所有检查点验证通过，无测试失败
## 测试失败: 无
## 未通过的检查点: 无
\`\`\`

**正确示例（未通过 - 测试失败）**:
\`\`\`
VERDICT: NOPASS
## 验证结果: NOPASS
## 原因: 单元测试未通过
## 测试失败:
- test_add_user: Expected 200 but got 404
- test_delete_user: Timeout after 5000ms
## 未通过的检查点:
- CP-2-unit-test
## 详细反馈: 边界条件处理不正确，需要修复删除功能的错误处理。
\`\`\`

**正确示例（未通过 - 检查点失败）**:
\`\`\`
VERDICT: NOPASS
## 验证结果: NOPASS
## 原因: 检查点 CP-3-integration 未通过
## 测试失败:
- 集成测试 test_api_flow 失败
## 未通过的检查点:
- CP-3-integration
## 详细反馈: API 响应格式与需求不符，缺少必要字段。
\`\`\`

**正确示例（未通过 - 简洁版）**:
\`\`\`
VERDICT: NOPASS
## 验证结果: NOPASS
## 原因: 功能测试失败，返回结果不符合预期
## 测试失败: test_feature_x 返回 500 错误
## 未通过的检查点: CP-1-functional
\`\`\`

**错误示例（严禁这样输出）**:
\`\`\`
所有功能测试都已通过。 ← 错误：缺少 VERDICT 标记
VERDICT: 通过 ← 错误：使用了"通过"而非 PASS
VERDICT: 不通过 ← 错误：使用了"不通过"而非 NOPASS
VERDICT: PASS ← 错误：说 PASS 但未通过的检查点不为空
## 未通过的检查点:
- CP-1-test
\`\`\`

现在开始验证。`;

/**
 * 评估阶段默认模板
 * @source harness-evaluator.ts buildEvaluationPrompt()
 */
export const DEFAULT_EVALUATION_TEMPLATE: PromptTemplate = `# 架构评估任务

你是一位资深架构师。你需要从架构角度评估任务的完成质量，判断是否满足验收标准，并给出明确的后续动作建议。

**重要**: 你必须独立判断，不要因为这是 AI 完成的工作就给予优待。

## 任务信息
- ID: {taskId}
- 标题: {title}
- 类型: {type}
{descriptionSection}
## 验收标准
{acceptanceCriteriaList}
{verificationCommandsSection}
{checkpointsSection}
{humanCheckpointsSection}
{evidenceSection}
{completedCheckpointsSection}
{phantomTasksSection}
## 评估要求
1. 阅读任务描述和验收标准
2. 检查相关代码文件
3. 运行验证命令（如有）
4. 验证每个验收标准是否满足
5. 检查代码质量（可读性、可维护性）
6. 检查开发者是否违反禁止操作（特别是是否创建了额外任务）

## 输出格式（严格遵守）

**强制要求**: 你的输出必须以以下两行标记开头:
\`\`\`
EVALUATION_RESULT: PASS
EVALUATION_REASON: [简要说明为什么通过或不通过]
\`\`\`
或:
\`\`\`
EVALUATION_RESULT: NOPASS
EVALUATION_REASON: [简要说明为什么通过或不通过]
\`\`\`

然后按以下 Markdown 格式输出详细评估:
\`\`\`
## 评估结果: PASS 或 NOPASS
## 原因: [简要说明为什么通过或不通过]
## 后续动作: [resolve|redevelop|retest|reevaluate|escalate_human]
## 失败分类: [acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other]
## 未满足的标准: [列出未满足的验收标准，如果没有则为空]
## 未完成的检查点: [列出未完成的检查点，如果没有则为空]
## 详细反馈: [可选的详细反馈]
\`\`\`

**重要格式要求**:
- 你必须严格按照上述格式输出，不得省略或修改格式
- 必须输出 EVALUATION_RESULT: PASS 或 EVALUATION_RESULT: NOPASS 标记行
- 如果你认为任务通过，必须输出 PASS（不是"通过"、"满足"等词语）
- 如果你认为任务未通过，必须输出 NOPASS（不是"不通过"、"未满足"等词语）

**正确示例（通过）**:
\`\`\`
EVALUATION_RESULT: PASS
EVALUATION_REASON: 所有验收标准已满足，代码质量良好
## 评估结果: PASS
## 原因: 所有验收标准已满足，代码质量良好
## 后续动作: resolve
## 失败分类:
## 未满足的标准:
## 未完成的检查点:
## 详细反馈: 实现完整，代码清晰。
\`\`\`

**正确示例（未通过）**:
\`\`\`
EVALUATION_RESULT: NOPASS
EVALUATION_REASON: 缺少单元测试，构建失败
## 评估结果: NOPASS
## 原因: 缺少单元测试，构建失败
## 后续动作: redevelop
## 失败分类: test_failure
## 未满足的标准: - 所有测试通过
## 未完成的检查点: - CP-bun-run-build-零错误
## 详细反馈: 开发者未编写任何测试。
\`\`\`

**错误示例（严禁这样输出）**:
\`\`\`
所有验收标准均已满足，实现清晰。  ← 错误：缺少 EVALUATION_RESULT 标记
EVALUATION_RESULT: 通过  ← 错误：使用了"通过"而非 PASS
EVALUATION_RESULT: 不通过  ← 错误：使用了"不通过"而非 NOPASS
\`\`\`

**动作说明（评估结果为 NOPASS 时必须填写）**:
- resolve: 评估通过，任务可以完成（仅 PASS 时使用）
- redevelop: 实现有严重问题，需要从开发阶段重新开始
- retest: 实现基本OK但测试未通过，从QA阶段重试即可
- reevaluate: 评估不明确需要更多信息，重新评估
- escalate_human: 问题超出自动处理范围，需要人工介入

现在开始评估。`;

/**
 * 需求增强默认模板
 * @source ai-metadata.ts buildRequirementPrompt()
 */
export const DEFAULT_REQUIREMENT_TEMPLATE: PromptTemplate = `你是一个项目管理助手。根据以下需求描述，提取结构化元数据。

## 输入
需求描述:
{description}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。
如果无法判断某个字段，设为 null 而非猜测。

## 输出格式
{
  "title": "动词开头，10-50 字符的简洁标题",
  "description": "结构化的详细描述，包含背景、目标、方案要点",
  "type": "bug | feature | research | docs | refactor | test | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "recommendedRole": "推荐角色或 null",
  "checkpoints": [
    {
      "description": "[ai review] 动词开头的具体验证步骤（如：已实现用户认证逻辑）",
      "requiresHuman": false
    },
    {
      "description": "[human qa] 需要人工确认的主观验证（如：确认UI符合设计稿）",
      "requiresHuman": true
    }
  ],
  "dependencies": ["依赖项 ID 列表或 null"]
}

## 约束
- title 必须以动词开头，长度 10-50 字符
- checkpoints 每条 description 必须以 [ai review]/[ai qa]/[human qa]/[script] 前缀开头
- checkpoints 不能是泛泛的阶段名称（如"开发阶段""测试阶段"）
- priority 必须是 P0/P1/P2/P3 之一或 null
- 只输出 JSON

## 检查点前缀使用规则（必须遵守）

每个检查点描述必须以以下前缀开头，用于标识验证类别：

| 前缀 | 使用场景 | 验证阶段 | requiresHuman |
|------|----------|----------|---------------|
| [ai review] | 代码审查、结构检查、代码质量、逻辑正确性、重构、命名规范 | code_review | false |
| [ai qa] | 测试、验证、覆盖率、自动化检查、回归测试、类型检查 | qa_verification | false |
| [script] | 脚本执行、构建、命令行操作、CI/CD、部署、打包 | evaluation | false |

## 前缀选择示例

- "[ai review] login.ts 已实现用户认证逻辑"
- "[ai review] 重构 userService.ts 中的重复代码"
- "[ai qa] 登录模块单元测试覆盖率 >= 80%"
- "[ai qa] 运行 tsc --noEmit 确认类型检查通过"
- "[script] bun run build 构建成功"
- "[script] 运行 npm run lint 代码检查通过"

## requiresHuman 字段使用说明

- requiresHuman: true - 表示此检查点需要人工验证
- requiresHuman: false - 表示此检查点可由 AI 或脚本自动验证（用于 [ai review]、[ai qa]、[script] 前缀）

## 任务拆分最佳实践（影响 checkpoints 生成）
1. 单个任务预估耗时控制在 15 分钟以内
2. 按架构层级拆分优先级：Layer0(类型定义) → Layer1(工具函数) → Layer2(核心逻辑) → Layer3(命令入口)
3. 按文件目录边界拆分，每个子任务聚焦同一目录下的文件
4. 检查点必须具体可验证，格式如"[ai review] 实现 XXX 函数""[ai qa] 运行 tsc --noEmit 通过"
5. 依赖关系遵循底层先于上层（先改类型，再改工具，再改命令）
6. 如果需求涉及 3 个以上文件或跨 2 个以上目录，应生成粒度更细的检查点，暗示可拆分
7. 根据验证方式选择正确的前缀和 requiresHuman 值
{errorFeedback}`;

/**
 * 检查点推断默认模板
 * @source ai-metadata.ts buildCheckpointsPrompt()
 */
export const DEFAULT_CHECKPOINTS_TEMPLATE: PromptTemplate = `你是一个项目管理助手。为以下任务生成检查点列表。

## 任务描述
{description}

## 任务类型
{type}
{existingCheckpointsSection}
## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "checkpoints": [
    {
      "description": "[ai review] 动词开头的具体验证步骤（如：已实现用户认证逻辑）",
      "requiresHuman": false
    },
    {
      "description": "[ai qa] 动词开头的验证步骤（如：单元测试覆盖率 >= 80%）",
      "requiresHuman": false
    },
    {
      "description": "[script] 脚本或命令验证（如：运行 bun run build 构建成功）",
      "requiresHuman": false
    }
  ]
}

## 检查点前缀使用规则（必须遵守）

每个检查点描述必须以以下前缀开头，用于标识验证类别和验证阶段：

| 前缀 | 使用场景 | 验证阶段 |
|------|----------|----------|
| [ai review] | 代码审查、结构检查、代码质量、逻辑正确性、重构、命名规范 | code_review |
| [ai qa] | 测试、验证、覆盖率、自动化检查、回归测试、类型检查 | qa_verification |
| [script] | 脚本执行、构建、命令行操作、CI/CD、部署、打包 | evaluation |

## 前缀选择示例

- "[ai review] login.ts 已实现用户认证逻辑"
- "[ai review] 重构 userService.ts 中的重复代码，提高可维护性"
- "[ai qa] 登录模块单元测试覆盖率 >= 80%"
- "[ai qa] 运行 tsc --noEmit 确认类型检查无错误"
- "[script] bun run build 构建成功"
- "[script] 运行 npm run lint 代码检查通过"

## requiresHuman 字段使用说明

- requiresHuman: true - 表示此检查点需要人工验证
- requiresHuman: false - 表示此检查点可由 AI 或脚本自动验证（对应 [ai review]、[ai qa]、[script] 前缀）

## 约束
- 每条检查点描述必须以 [ai review]/[ai qa]/[human qa]/[script] 前缀开头
- 不能是泛泛的阶段名称（如"开发阶段""测试阶段"）
- 每条描述至少 10 字符（不含前缀）
- 只输出 JSON

## 检查点质量规范
1. 每条必须是可独立验证的原子操作，例如"实现 parseConfig 函数"而非"完成配置解析"
2. 引用具体文件路径或函数名，例如"修改 src/utils/foo.ts 中的 bar() 函数"
3. 验证类检查点附带可执行命令，例如"运行 tsc --noEmit 确认类型检查通过"
4. 按架构层级排列：先类型定义 → 再工具函数 → 再核心逻辑 → 最后命令入口
5. 依赖底层完成后再做上层，例如先"定义 XXX 接口"再"实现 XXX 功能"
6. 每个检查点预估耗时不超过 15 分钟，超过则应拆分为多条
7. 根据验证方式选择正确的前缀和 requiresHuman 值`;

/**
 * 质量评分默认模板
 * @source ai-metadata.ts buildQualityPrompt()
 */
export const DEFAULT_QUALITY_TEMPLATE: PromptTemplate = `你是一个项目质量审查助手。评估以下任务的质量。

## 任务数据
{taskData}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "score": 0-100,
  "issues": [
    {"field": "字段名", "severity": "error|warning|info", "message": "问题描述"}
  ],
  "suggestions": ["改进建议列表"]
}

## 评估维度
- 标题: 是否动词开头，是否具体
- 描述: 是否包含足够的上下文和目标
- 检查点: 是否具体可验证（必须引用具体文件路径、函数名或可执行命令）
- 优先级: 是否合理
- 依赖: 是否遗漏关键依赖
- 任务粒度: 单个任务是否控制在15分钟内可完成
- 层级拆分: 涉及多文件时是否按架构层级（类型→工具→核心→命令）拆分检查点
- 只输出 JSON`;

/**
 * 重复检测默认模板
 * @source ai-metadata.ts buildDuplicatesPrompt()
 */
export const DEFAULT_DUPLICATES_TEMPLATE: PromptTemplate = `你是一个项目管理助手。检测以下任务列表中的语义重复。

## 任务列表
{taskList}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "duplicates": [
    {
      "taskIds": ["重复任务ID列表"],
      "similarity": 0.0-1.0,
      "keepTaskId": "建议保留的任务ID或null",
      "reason": "判断依据或null"
    }
  ]
}

## 约束
- 只报告相似度 >= 0.7 的组
- 只输出 JSON`;

/**
 * 过期评估默认模板
 * @source ai-metadata.ts buildStalenessPrompt()
 */
export const DEFAULT_STALENESS_TEMPLATE: PromptTemplate = `你是一个项目管理助手。评估以下任务是否陈旧。

## 任务数据
{taskData}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

## 输出格式
{
  "isStale": true/false,
  "stalenessScore": 0.0-1.0,
  "suggestedAction": "keep | close | update | split",
  "reason": "判断依据"
}

## 约束
- 只输出 JSON`;

/**
 * Bug 报告默认模板
 * @source ai-metadata.ts buildBugReportPrompt()
 */
export const DEFAULT_BUG_REPORT_TEMPLATE: PromptTemplate = `你是一个 Bug 分析助手。将以下 Bug 报告转为结构化需求文档。

## Bug 报告
{reportContent}
{logContextSection}
## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。
如果无法判断某个字段，设为 null 而非猜测。

## 输出格式
{
  "title": "动词开头的标题",
  "description": "结构化描述：背景、复现步骤、期望行为、实际行为",
  "type": "bug | feature | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "checkpoints": ["验证步骤列表或null"],
  "rootCause": "根因分析或null",
  "impactScope": "影响范围或null"
}

## 约束
- title 必须以动词开头
- checkpoints 每条必须以动词开头
- 只输出 JSON`;

/**
 * 语义依赖推断默认模板
 * @source ai-metadata.ts buildSemanticDependencyPrompt()
 */
export const DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE: PromptTemplate = `你是一个项目管理助手。分析以下任务列表，推断任务间的语义依赖关系。

## 任务列表
{taskList}

## 输出要求
输出纯 JSON 对象，不要用 markdown 代码块包裹。

分析每个任务的标题和描述中的功能语义，推断任务间隐含的依赖关系。
例如：
- 登录功能依赖用户模型定义
- API 端点依赖数据库 schema
- 工具函数依赖类型定义
- 测试任务依赖被测试的实现

## 输出格式
{
  "dependencies": [
    {
      "taskId": "依赖方任务ID",
      "depTaskId": "被依赖方任务ID",
      "reason": "推断依赖的原因"
    }
  ]
}

## 约束
- 只推断语义上合理的依赖，不要推断已通过文件重叠检测到的依赖
- taskId 必须依赖 depTaskId（depTaskId 对应的任务应先完成）
- reason 必须说明推断的语义原因
- 如果没有发现语义依赖，返回空数组
- 只输出 JSON`;

// ============================================================
// 默认模板注册表
// ============================================================

/**
 * 所有默认模板的注册表
 * 键为模板名称，值为默认模板字符串
 */
export const DEFAULT_TEMPLATES: Record<PromptTemplateName, PromptTemplate> = {
  dev: DEFAULT_DEV_TEMPLATE,
  codeReview: DEFAULT_CODE_REVIEW_TEMPLATE,
  qa: DEFAULT_QA_TEMPLATE,
  evaluation: DEFAULT_EVALUATION_TEMPLATE,
  requirement: DEFAULT_REQUIREMENT_TEMPLATE,
  checkpoints: DEFAULT_CHECKPOINTS_TEMPLATE,
  quality: DEFAULT_QUALITY_TEMPLATE,
  duplicates: DEFAULT_DUPLICATES_TEMPLATE,
  staleness: DEFAULT_STALENESS_TEMPLATE,
  bugReport: DEFAULT_BUG_REPORT_TEMPLATE,
  semanticDependency: DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE,
};

// ============================================================
// loadPromptTemplate - 配置加载函数
// ============================================================

/**
 * 加载提示词模板。
 *
 * 优先级：用户自定义配置 > 内置默认模板。
 *
 * 1. 从 config.json 的 prompts.{name} 读取用户自定义模板
 * 2. 如果存在则返回用户自定义模板
 * 3. 否则返回内置默认模板
 *
 * @param name - 模板名称
 * @param cwd - 工作目录（用于定位 config.json）
 * @returns 模板字符串
 *
 * @example
 * // 有自定义配置时返回自定义模板
 * loadPromptTemplate('dev', cwd) // => 用户自定义的开发模板
 *
 * // 无配置时返回默认模板
 * loadPromptTemplate('qa', cwd)  // => DEFAULT_QA_TEMPLATE
 */
export function loadPromptTemplate(name: PromptTemplateName, cwd?: string): PromptTemplate {
  const config = cwd ? readConfig(cwd) : null;
  const prompts = config?.prompts as Record<string, unknown> | undefined;

  if (prompts && typeof prompts[name] === 'string') {
    return prompts[name];
  }

  return DEFAULT_TEMPLATES[name];
}
