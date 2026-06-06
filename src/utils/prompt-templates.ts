/**
 * Prompt Template System
 *
 * Provides type definitions, template interpolation, default template constants, and configuration loading mechanisms.
 * Supports customizing prompt templates via the prompts configuration section in config.json.
 */

import { readConfig } from '../commands/config.js';
import { getI18n } from '../i18n/index.js';
import type { Language } from '../i18n/index.js';

// ============================================================
// Type Definitions
// ============================================================

/**
 * Template Variable Type
 *
 * Keys are variable names (corresponding to {variableName} in the template), values are strings or numbers.
 * Keys with undefined values will not replace placeholders in the template.
 */
export type TemplateVariables = Record<string, string | number | undefined>;

/**
 * Prompt Template Type
 *
 * A record mapping language codes to template strings with {variableName} placeholders.
 * Call resolveTemplate() to replace placeholders with actual values.
 */
export type PromptTemplate = Record<Language, string>;

/**
 * Known Prompt Template Names
 *
 * Corresponds to 11 hardcoded prompt construction points (see investigation-report-20260407/15).
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
  | 'semanticDependency'
  | 'decomposition';

/** List of all known template names */
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
  'decomposition',
];

// ============================================================
// resolveTemplate - Template Interpolation Function
// ============================================================

/**
 * Replace {variableName} placeholders in the template with actual values.
 *
 * - Variables not provided retain original placeholders (not removed)
 * - Supports string and number type values
 * - No recursive replacement (prevents injection loops)
 *
 * @param template - Template string with {variable} placeholders
 * @param variables - Mapping of variable names to values
 * @returns Replaced string
 *
 * @example
 * resolveTemplate('{taskId} - {title}', {taskId: 'T1', title: 'Test'})
 * // => 'T1 - Test'
 */
export function resolveTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return match;
    }
    return String(value);
  });
}

// ============================================================
// Default Template Constants (Extracted from code, preserving original text)
// ============================================================

/**
 * Development Phase Default Template
 * @source harness-executor.ts buildDevPrompt()
 */
export const DEFAULT_DEV_TEMPLATE: PromptTemplate = {
  zh: `# 任务: {title}

## 任务ID: {taskId}
## 类型: {type}
## 优先级: {priority}
{timeoutHeader}
{descriptionSection}
{dependenciesSection}
{acceptanceCriteriaSection}
{checkpointsSection}
## ⚠️ 重要：检查点是验收标准

**检查点定义了本任务的验收标准**。你必须实现检查点中描述的代码或功能，而非仅仅验证它们。

- 检查点中的 \`[script]\` 前缀表示需要实现具体的代码产出（如类型定义、函数实现）
- 检查点中的 \`[ai review]\` 前缀表示需要实现代码并通过代码审核
- 检查点中的 \`[ai qa]\` 前缀表示需要实现功能并通过 QA 验证

**错误理解示例**：
- ❌ "检查点说要定义 FailureType 枚举，我写测试来验证它是否存在" — 这是错误的！
- ✅ "检查点说要定义 FailureType 枚举，我需要在 src/types/task.ts 中实现它" — 这是正确的！

## 指示

{roleDeclaration}

{timeoutInstruction}

### 开发步骤（按顺序执行）

1. **理解检查点要求** — 仔细阅读每个检查点，理解需要实现什么代码或功能
2. **实现检查点要求的代码** — 这是主要工作，占开发时间 80% 以上
3. **验证实现** — 运行 \`npm run build\` 确保编译通过
4. **编写自测** — 为实现的功能编写基本测试（Happy Path + 关键边界），验证实现正确性
5. **运行测试** — \`npm test\` 确保自测通过
6. **总结实现** — 在开发报告中说明实现了哪些检查点

### 自测说明

自测是验证你的实现是否正确，而非替代实现。自测应该测试你实现的代码，而非测试现有代码。

{extraInstructionsSection}
{customRequirements}
## ⛔ 禁止操作（严格遵守）

以下操作被严格禁止：

1. **禁止创建新任务** - 不要运行 \`task create\`、\`init-requirement\` 或任何创建任务的命令
2. **禁止修改任务元数据** - 不要修改 \`.projmnt4claude/tasks/\` 下的 meta.json 文件
3. **禁止创建子任务** - 不要将当前任务拆分为多个子任务并尝试创建它们
4. **禁止只写测试不实现** - 检查点要求实现代码，而非写测试验证代码是否存在

如果任务确实需要拆分，请在开发报告中 **建议** 拆分方案，由人工决定是否创建新任务。
违反以上任何禁令将导致评估不通过。`,
  en: `# Task: {title}

## Task ID: {taskId}
## Type: {type}
## Priority: {priority}
{timeoutHeader}
{descriptionSection}
{dependenciesSection}
{acceptanceCriteriaSection}
{checkpointsSection}
## ⚠️ Important: Checkpoints are Acceptance Criteria

**Checkpoints define the acceptance criteria for this task**. You must implement the code or functionality described in checkpoints, not merely verify them.

- \`[script]\` prefix means you need to implement concrete code artifacts (e.g., type definitions, function implementations)
- \`[ai review]\` prefix means you need to implement code and pass code review
- \`[ai qa]\` prefix means you need to implement functionality and pass QA verification

**Wrong Understanding Example**:
- ❌ "Checkpoint says to define FailureType enum, I'll write tests to verify it exists" — This is WRONG!
- ✅ "Checkpoint says to define FailureType enum, I need to implement it in src/types/task.ts" — This is CORRECT!

## Instructions

{roleDeclaration}

{timeoutInstruction}

### Development Steps (Execute in order)

1. **Understand checkpoint requirements** — Carefully read each checkpoint to understand what code or functionality to implement
2. **Implement checkpoint-required code** — This is the main work, taking 80%+ of development time
3. **Verify implementation** — Run \`npm run build\` to ensure compilation passes
4. **Write self-tests** — Write basic tests for your implementation (Happy Path + key boundaries) to verify correctness
5. **Run tests** — \`npm test\` to ensure self-tests pass
6. **Summarize implementation** — In dev report, explain which checkpoints you implemented

### Self-Test Note

Self-tests verify your implementation is correct, not replace implementation. Tests should test the code you implemented, not test existing code.

{extraInstructionsSection}
{customRequirements}
## ⛔ Prohibited Operations (Strictly Enforced)

The following operations are strictly prohibited:

1. **Do NOT create new tasks** - Do not run \`task create\`, \`init-requirement\`, or any task creation commands
2. **Do NOT modify task metadata** - Do not modify meta.json files under \`.projmnt4claude/tasks/\`
3. **Do NOT create subtasks** - Do not split the current task into multiple subtasks and attempt to create them
4. **Do NOT write tests without implementation** - Checkpoints require implementing code, not writing tests to verify code exists

If the task truly needs to be split, **suggest** a split plan in the development report and let humans decide whether to create new tasks.
Violating any of the above prohibitions will result in evaluation failure.`,
};

/**
 * Code Review Phase Default Template
 * @source harness-code-reviewer.ts buildCodeReviewPrompt()
 */
export const DEFAULT_CODE_REVIEW_TEMPLATE: PromptTemplate = {
  zh: `{roleDeclaration}

# 代码审核任务

**重要**: 你必须严格审核，发现所有代码质量问题。

{retryContextSection}## 任务信息
- ID: {taskId}
- 标题: {title}
{descriptionSection}
## 代码审核检查点
{checkpointsList}
{changesSection}
{evidenceSection}
{customRequirements}

**用户定制扩展要求**: 上述用户定制需求与默认审核要求具有同等约束力，必须在审核过程中同步遵守。

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

现在开始审核。`,
  en: `{roleDeclaration}

# Code Review Task

**Important**: You must review strictly and identify all code quality issues.

{retryContextSection}## Task Information
- ID: {taskId}
- Title: {title}
{descriptionSection}
## Code Review Checkpoints
{checkpointsList}
{changesSection}
{evidenceSection}
{customRequirements}

**User Custom Extended Requirements**: The above user customization requirements have the same binding force as the default review requirements and must be followed during the review process.

## Review Requirements
{reviewFocus}
## Output Format
Please output the review result in the following format:
\`\`\`
VERDICT: PASS or VERDICT: NOPASS
## Review Result: PASS or NOPASS
## Reason: [Brief explanation of why it passed or failed]
## Code Quality Issues: [List of issues found, empty if none]
## Failed Checkpoints: [List of checkpoint IDs that failed, empty if none]
## Detailed Feedback: [Optional detailed feedback]
\`\`\`

**Important**: Must output VERDICT: PASS or VERDICT: NOPASS, do not use "passed", "failed", or other words.

Begin review now.`,
};

/**
 * QA Verification Phase Default Template
 * @source harness-qa-tester.ts buildQAPrompt()
 */
export const DEFAULT_QA_TEMPLATE: PromptTemplate = {
  zh: `{roleDeclaration}

# QA 验证任务

**重要**: 你必须严格验证，确保所有功能正常工作。

## 开发阶段产物

开发阶段已生成以下产物，请基于此进行验证：

**开发报告路径**: {devReportPath}

请先阅读开发报告，了解开发者声明的变更和自测情况。

## 验证原则

请遵循以下原则进行验证：

1. **功能优先**: 验证的核心是功能是否正确实现，而非实现形式。
   - 内联函数与类方法在功能等价时应视为通过。例如：如果任务要求创建一个类方法，但实现使用了功能等价的内联函数/导出函数，只要功能正确就应通过。
   - 不要因为代码组织方式（如使用独立函数代替类方法）而判定为不通过，除非任务明确要求特定的实现结构。

2. **解析伪影识别**: 忽略由自然语言描述算法步骤时产生的结构要求。
   - 任务描述中的"创建类"、"定义接口"等措辞可能是算法描述的产物，不构成实际的代码结构要求。
   - 如果代码通过不同结构（如模块级函数代替类方法）实现了相同功能，应视为满足要求。

{retryContextSection}{coverageGapSection}
## 任务信息
- ID: {taskId}
- 标题: {title}
{descriptionSection}
## QA 验证检查点
{checkpointsList}
## 代码审核结果
- 结果: {codeReviewResult}
- 原因: {codeReviewReason}

{customRequirements}
## 工作流程

### 步骤 1: 分析开发产物

1. 阅读开发报告 ({devReportPath})
2. 了解开发者声明的变更内容
3. 查看开发者编写的自测试用例
4. 识别开发者已验证的范围

### 步骤 2: 识别测试缺口

基于开发报告和验收标准，识别以下类型的测试缺口：

| 缺口类型 | 说明 | 示例 |
|---------|------|------|
| 未覆盖场景 | 开发者自测未覆盖的功能场景 | 开发者只测了正常路径，未测异常路径 |
| 边界条件缺失 | 边界值或极限情况未测试 | 空输入、最大值、并发场景 |
| 集成测试缺失 | 模块间交互未验证 | API 与数据库的集成 |
| 回归测试缺失 | 变更可能影响的现有功能 | 重构后原有功能是否正常 |
| 性能测试缺失 | 性能相关验证未覆盖 | 大数据量下的响应时间 |

### 步骤 3: 扩展测试

针对识别的缺口，编写并运行补充测试：

1. 为每个缺口类型编写测试用例
2. 运行新增测试用例
3. 记录测试结果

### 步骤 4: 报告结果

汇总所有测试结果，输出验证报告。

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
## 新增测试用例: [列出本次验证新增的测试用例，如果没有则为空]
## 覆盖缺口: [列出本次验证覆盖的缺口类型，如果没有则为空]
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

现在开始验证。`,
  en: `{roleDeclaration}

# QA Verification Task

**Important**: You must verify strictly and ensure all functionality works correctly.

## Development Phase Artifacts

The development phase has generated the following artifacts, please verify based on them:

**Development Report Path**: {devReportPath}

Please read the development report first to understand the developer's declared changes and self-testing status.

## Verification Principles

Please follow these principles during verification:

1. **Functionality First**: The core of verification is whether functionality is correctly implemented, not the form of implementation.
   - Inline functions and class methods should be considered equivalent if they have the same functionality. For example: if the task requires creating a class method, but the implementation uses an equivalent inline/exported function, it should pass as long as the functionality is correct.
   - Do not mark as failed due to code organization (such as using standalone functions instead of class methods), unless the task explicitly requires a specific implementation structure.

2. **Parsing Artifact Recognition**: Ignore structural requirements that arise from natural language descriptions of algorithm steps.
   - Phrases like "create class" or "define interface" in task descriptions may be artifacts of algorithm description and do not constitute actual code structure requirements.
   - If code achieves the same functionality through different structures (such as module-level functions instead of class methods), it should be considered as meeting the requirements.

{retryContextSection}{coverageGapSection}
## Task Information
- ID: {taskId}
- Title: {title}
{descriptionSection}
## QA Verification Checkpoints
{checkpointsList}
## Code Review Result
- Result: {codeReviewResult}
- Reason: {codeReviewReason}

{customRequirements}
## Workflow

### Step 1: Analyze Development Artifacts

1. Read the development report ({devReportPath})
2. Understand the developer's declared changes
3. Review the self-test cases written by the developer
4. Identify the scope already verified by the developer

### Step 2: Identify Test Gaps

Based on the development report and acceptance criteria, identify the following types of test gaps:

| Gap Type | Description | Example |
|----------|-------------|---------|
| Uncovered Scenarios | Functional scenarios not covered by developer's self-tests | Developer only tested happy path, not exception paths |
| Missing Boundary Conditions | Boundary values or edge cases not tested | Empty input, max values, concurrent scenarios |
| Missing Integration Tests | Module interactions not verified | API and database integration |
| Missing Regression Tests | Existing functionality potentially affected by changes | Whether original functionality works after refactoring |
| Missing Performance Tests | Performance-related verification not covered | Response time under large data volumes |

### Step 3: Expand Testing

For identified gaps, write and run supplementary tests:

1. Write test cases for each gap type
2. Run the new test cases
3. Record test results

### Step 4: Report Results

Summarize all test results and output a verification report.

## Verification Requirements
{testStrategy}
## Output Format

Please output the verification result in the following format:

\`\`\`
VERDICT: PASS or VERDICT: NOPASS
## Verification Result: PASS or NOPASS
## Reason: [Brief explanation of why it passed or failed]
## Test Failures: [List of failed tests, empty if none]
## Failed Checkpoints: [List of checkpoint IDs that failed, empty if none]
## New Test Cases: [List of new test cases added in this verification, empty if none]
## Coverage Gaps: [List of gap types covered in this verification, empty if none]
## Detailed Feedback: [Optional detailed feedback]
\`\`\`

**Important Format Requirements**:
- Must output VERDICT: PASS or VERDICT: NOPASS marker line
- Do not use "passed", "failed", or other Chinese words
- Must output PASS when all checkpoints pass
- Must output NOPASS when any checkpoint fails

**VERDICT Rules**:
- **PASS**: Must satisfy ALL of the following conditions:
  1. All automated checkpoint verifications pass
  2. No test failures
  3. Functionality meets expectations
  4. Code review result is PASS
- **NOPASS**: Any of the following conditions will result in NOPASS:
  1. Any test failures exist
  2. Any checkpoint not passed
  3. Functionality does not meet expectations
  4. Code review result is NOPASS

Begin verification now.`,
};

/**
 * Evaluation Phase Default Template
 * @source harness-evaluator.ts buildEvaluationPrompt()
 */
export const DEFAULT_EVALUATION_TEMPLATE: PromptTemplate = {
  zh: `{roleDeclaration}

# 架构评估任务

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
{customRequirements}

**用户定制扩展要求**: 上述用户定制需求与默认评估要求具有同等约束力，必须在评估过程中同步遵守。

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
## 后续动作: [resolve|redevelop|escalate_human]
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
- redevelop: 实现有问题，需要从开发阶段重新开始
- escalate_human: 问题超出自动处理范围，需要人工介入

现在开始评估。`,
  en: `{roleDeclaration}

# Architecture Evaluation Task

**Important**: You must judge independently and do not give preferential treatment just because this is AI-completed work.

## Task Information
- ID: {taskId}
- Title: {title}
- Type: {type}
{descriptionSection}
## Acceptance Criteria
{acceptanceCriteriaList}
{verificationCommandsSection}
{checkpointsSection}
{humanCheckpointsSection}
{evidenceSection}
{completedCheckpointsSection}
{phantomTasksSection}
{customRequirements}

**User Custom Extended Requirements**: The above user customization requirements have the same binding force as the default evaluation requirements and must be followed during the evaluation process.

## Evaluation Requirements
1. Read task description and acceptance criteria
2. Check relevant code files
3. Run verification commands (if any)
4. Verify each acceptance criterion is satisfied
5. Check code quality (readability, maintainability)
6. Check if developer violated prohibited operations (especially creating extra tasks)

## Output Format (Strictly Follow)

**Mandatory**: Your output must start with these two marker lines:
\`\`\`
EVALUATION_RESULT: PASS
EVALUATION_REASON: [Brief explanation of why it passed or failed]
\`\`\`
Or:
\`\`\`
EVALUATION_RESULT: NOPASS
EVALUATION_REASON: [Brief explanation of why it passed or failed]
\`\`\`

Then output detailed evaluation in this Markdown format:
\`\`\`
## Evaluation Result: PASS or NOPASS
## Reason: [Brief explanation of why it passed or failed]
## Next Action: [resolve|redevelop|escalate_human]
## Failure Category: [acceptance_criteria|code_quality|test_failure|architecture|specification|phantom_task|incomplete|other]
## Unmet Criteria: [List unmet acceptance criteria, empty if none]
## Incomplete Checkpoints: [List incomplete checkpoints, empty if none]
## Detailed Feedback: [Optional detailed feedback]
\`\`\`

**Important Format Requirements**:
- You must strictly follow the above format, do not omit or modify it
- Must output EVALUATION_RESULT: PASS or EVALUATION_RESULT: NOPASS marker line
- If you think the task passed, must output PASS (not "passed", "satisfied", etc.)
- If you think the task failed, must output NOPASS (not "failed", "not satisfied", etc.)

**Correct Example (Pass)**:
\`\`\`
EVALUATION_RESULT: PASS
EVALUATION_REASON: All acceptance criteria satisfied, good code quality
## Evaluation Result: PASS
## Reason: All acceptance criteria satisfied, good code quality
## Next Action: resolve
## Failure Category:
## Unmet Criteria:
## Incomplete Checkpoints:
## Detailed Feedback: Implementation complete, code clear.
\`\`\`

**Correct Example (Fail)**:
\`\`\`
EVALUATION_RESULT: NOPASS
EVALUATION_REASON: Missing unit tests, build failed
## Evaluation Result: NOPASS
## Reason: Missing unit tests, build failed
## Next Action: redevelop
## Failure Category: test_failure
## Unmet Criteria: - All tests pass
## Incomplete Checkpoints: - CP-bun-run-build-zero-errors
## Detailed Feedback: Developer did not write any tests.
\`\`\`

**Incorrect Example (Do NOT output like this)**:
\`\`\`
All acceptance criteria satisfied, implementation clear.  ← Error: Missing EVALUATION_RESULT marker
EVALUATION_RESULT: passed  ← Error: Used "passed" instead of PASS
EVALUATION_RESULT: failed  ← Error: Used "failed" instead of NOPASS
\`\`\`

**Action Descriptions (Required when evaluation is NOPASS)**:
- resolve: Evaluation passed, task can be completed (only use when PASS)
- redevelop: Implementation issues, need to restart from development phase
- escalate_human: Issue beyond automatic processing scope, needs human intervention

Begin evaluation now.`,
};

/**
 * Requirement Enhancement Default Template
 * @source ai-metadata.ts buildRequirementPrompt()
 */
export const DEFAULT_REQUIREMENT_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目管理助手。根据以下需求描述，提取结构化元数据。

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
| [script] | 可自动执行的验证脚本：构建、部署、CI/CD、打包、lint、test（必须有 verification.commands） | evaluation | false |

## 前缀选择示例

- "[ai review] login.ts 已实现用户认证逻辑"
- "[ai review] 重构 userService.ts 中的重复代码"
- "[ai qa] 登录模块单元测试覆盖率 >= 80%"
- "[ai qa] 运行 tsc --noEmit 确认类型检查通过"
- "[script] npm run build 构建成功"
- "[script] npm run lint 代码检查通过"

## [script] 前缀使用约束

- [script] 仅用于可自动执行的验证脚本（构建、部署、CI/CD、lint、test）
- [script] 检查点必须包含 verification.commands 字段，指定执行命令
- 代码修改任务不应使用 [script] 前缀（使用 [ai review] 或无前缀）

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
{errorFeedback}`,
  en: `You are a project management assistant. Extract structured metadata from the following requirement description.

## Input
Requirement Description:
{description}

## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.
If a field cannot be determined, set it to null rather than guessing.

## Output Format
{
  "title": "Concise title starting with verb, 10-50 characters",
  "description": "Structured detailed description including background, goals, solution points",
  "type": "bug | feature | research | docs | refactor | test | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "recommendedRole": "Recommended role or null",
  "checkpoints": [
    {
      "description": "[ai review] Specific verification step starting with verb (e.g., user authentication logic implemented)",
      "requiresHuman": false
    },
    {
      "description": "[human qa] Subjective verification requiring human confirmation (e.g., confirm UI matches design)",
      "requiresHuman": true
    }
  ],
  "dependencies": ["List of dependency IDs or null"]
}

## Constraints
- Title must start with a verb, length 10-50 characters
- Each checkpoint description must start with [ai review]/[ai qa]/[human qa]/[script] prefix
- Checkpoints cannot be generic phase names (like "development phase", "testing phase")
- Priority must be P0/P1/P2/P3 or null
- Output JSON only

## Checkpoint Prefix Rules (Must Follow)

Each checkpoint description must start with one of these prefixes to identify the verification category:

| Prefix | Use Case | Verification Phase | requiresHuman |
|--------|----------|-------------------|---------------|
| [ai review] | Code review, structure check, code quality, logic correctness, refactoring, naming conventions | code_review | false |
| [ai qa] | Testing, verification, coverage, automated checks, regression testing, type checking | qa_verification | false |
| [script] | Automatically executable verification scripts: build, deploy, CI/CD, packaging, lint, test (must have verification.commands) | evaluation | false |

## Prefix Selection Examples

- "[ai review] login.ts has user authentication logic implemented"
- "[ai review] Refactor duplicate code in userService.ts"
- "[ai qa] Login module unit test coverage >= 80%"
- "[ai qa] Run tsc --noEmit to confirm type check passes"
- "[script] npm run build succeeds"
- "[script] npm run lint code check passes"

## [script] Prefix Usage Constraints

- [script] is only for automatically executable verification scripts (build, deploy, CI/CD, lint, test)
- [script] checkpoints must include verification.commands field specifying execution commands
- Code modification tasks should not use [script] prefix (use [ai review] or no prefix)

## requiresHuman Field Usage

- requiresHuman: true - Indicates this checkpoint requires human verification
- requiresHuman: false - Indicates this checkpoint can be automatically verified by AI or script (for [ai review], [ai qa], [script] prefixes)

## Task Decomposition Best Practices (Affects checkpoint generation)
1. Keep single task estimated time within 15 minutes
2. Split by architecture layer priority: Layer0(types) → Layer1(utilities) → Layer2(core logic) → Layer3(command entry)
3. Split by file directory boundaries, each subtask focuses on files in the same directory
4. Checkpoints must be concrete and verifiable, format like "[ai review] implement XXX function", "[ai qa] run tsc --noEmit passes"
5. Dependencies follow bottom-up order (types first, then utilities, then commands)
6. If requirement involves 3+ files or spans 2+ directories, generate finer-grained checkpoints hinting at possible splitting
7. Choose correct prefix and requiresHuman value based on verification method
{errorFeedback}`,
};

/**
 * Checkpoint Inference Default Template
 * @source ai-metadata.ts buildCheckpointsPrompt()
 */
export const DEFAULT_CHECKPOINTS_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目管理助手。为以下任务生成检查点列表。

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
      "description": "[script] 脚本或命令验证（如：运行 npm run build 构建成功）",
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
- "[script] npm run build 构建成功"
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
7. 根据验证方式选择正确的前缀和 requiresHuman 值`,
  en: `You are a project management assistant. Generate a checkpoint list for the following task.

## Task Description
{description}

## Task Type
{type}
{existingCheckpointsSection}
## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.

## Output Format
{
  "checkpoints": [
    {
      "description": "[ai review] Specific verification step starting with verb (e.g., user authentication logic implemented)",
      "requiresHuman": false
    },
    {
      "description": "[ai qa] Verification step starting with verb (e.g., unit test coverage >= 80%)",
      "requiresHuman": false
    },
    {
      "description": "[script] Script or command verification (e.g., run npm run build succeeds)",
      "requiresHuman": false
    }
  ]
}

## Checkpoint Prefix Rules (Must Follow)

Each checkpoint description must start with one of these prefixes to identify verification category and phase:

| Prefix | Use Case | Verification Phase |
|--------|----------|-------------------|
| [ai review] | Code review, structure check, code quality, logic correctness, refactoring, naming conventions | code_review |
| [ai qa] | Testing, verification, coverage, automated checks, regression testing, type checking | qa_verification |
| [script] | Script execution, build, command line operations, CI/CD, deployment, packaging | evaluation |

## Prefix Selection Examples

- "[ai review] login.ts has user authentication logic implemented"
- "[ai review] Refactor duplicate code in userService.ts for better maintainability"
- "[ai qa] Login module unit test coverage >= 80%"
- "[ai qa] Run tsc --noEmit to confirm type check has no errors"
- "[script] npm run build succeeds"
- "[script] Run npm run lint code check passes"

## requiresHuman Field Usage

- requiresHuman: true - Indicates this checkpoint requires human verification
- requiresHuman: false - Indicates this checkpoint can be automatically verified by AI or script (corresponds to [ai review], [ai qa], [script] prefixes)

## Constraints
- Each checkpoint description must start with [ai review]/[ai qa]/[human qa]/[script] prefix
- Cannot be generic phase names (like "development phase", "testing phase")
- Each description at least 10 characters (excluding prefix)
- Output JSON only

## Checkpoint Quality Standards
1. Each must be an independently verifiable atomic operation, e.g., "implement parseConfig function" not "complete config parsing"
2. Reference specific file paths or function names, e.g., "modify bar() function in src/utils/foo.ts"
3. Verification checkpoints include executable commands, e.g., "run tsc --noEmit to confirm type check passes"
4. Arrange by architecture layer: types first → then utilities → then core logic → finally command entry
5. Dependencies first: e.g., define XXX interface before implementing XXX functionality
6. Each checkpoint estimated time should not exceed 15 minutes, split into multiple if longer
7. Choose correct prefix and requiresHuman value based on verification method`,
};

/**
 * Quality Scoring Default Template
 * @source ai-metadata.ts buildQualityPrompt()
 */
export const DEFAULT_QUALITY_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目质量审查助手。评估以下任务的质量。

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
- 只输出 JSON`,
  en: `You are a project quality review assistant. Evaluate the quality of the following task.

## Task Data
{taskData}

## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.

## Output Format
{
  "score": 0-100,
  "issues": [
    {"field": "field name", "severity": "error|warning|info", "message": "issue description"}
  ],
  "suggestions": ["list of improvement suggestions"]
}

## Evaluation Dimensions
- Title: Whether it starts with a verb, whether it's specific
- Description: Whether it includes sufficient context and goals
- Checkpoints: Whether they are concrete and verifiable (must reference specific file paths, function names, or executable commands)
- Priority: Whether it's reasonable
- Dependencies: Whether key dependencies are missing
- Task Granularity: Whether single task can be completed within 15 minutes
- Layer Split: Whether checkpoints are split by architecture layer (types → utilities → core → commands) when involving multiple files
- Output JSON only`,
};

/**
 * Duplicate Detection Default Template
 * @source ai-metadata.ts buildDuplicatesPrompt()
 */
export const DEFAULT_DUPLICATES_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目管理助手。检测以下任务列表中的语义重复。

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
- 只输出 JSON`,
  en: `You are a project management assistant. Detect semantic duplicates in the following task list.

## Task List
{taskList}

## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.

## Output Format
{
  "duplicates": [
    {
      "taskIds": ["List of duplicate task IDs"],
      "similarity": 0.0-1.0,
      "keepTaskId": "Recommended task ID to keep or null",
      "reason": "Reasoning or null"
    }
  ]
}

## Constraints
- Only report groups with similarity >= 0.7
- Output JSON only`,
};

/**
 * Staleness Evaluation Default Template
 * @source ai-metadata.ts buildStalenessPrompt()
 */
export const DEFAULT_STALENESS_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目管理助手。评估以下任务是否陈旧。

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
- 只输出 JSON`,
  en: `You are a project management assistant. Evaluate whether the following task is stale.

## Task Data
{taskData}

## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.

## Output Format
{
  "isStale": true/false,
  "stalenessScore": 0.0-1.0,
  "suggestedAction": "keep | close | update | split",
  "reason": "Reasoning"
}

## Constraints
- Output JSON only`,
};

/**
 * Decomposition Default Template
 * @source ai-decomposition.ts buildDecompositionPrompt()
 */
export const DEFAULT_DECOMPOSITION_TEMPLATE: PromptTemplate = {
  zh: `你是一个专业的需求/问题分析专家。

## 任务
分析用户输入的内容，将其分解为独立的问题或需求列表。

## 分解规则
1. 如果是单个明确的需求，返回包含1个元素的列表
2. 如果是调查报告格式（包含"问题 X"、"### 现象"等章节），提取所有问题
3. 如果是复杂需求，拆分为可独立完成的子需求

## 每个问题/需求必须包含的字段
{
  "title": "简洁标题（动词开头，10-50字符）",
  "problem": "问题描述：现象、背景、影响（≥50字符）",
  "rootCause": "根因分析：为什么会出现这个问题（≥30字符，可选）",
  "solution": "解决方案：如何解决这个问题，具体步骤（≥50字符）",
  "priority": "P0 | P1 | P2 | P3",
  "type": "bug | feature | refactor | docs | test | research",
  "checkpoints": ["验证步骤1", "验证步骤2"]
}

## 输出格式
{
  "decomposable": true | false,
  "reason": "分解失败的原因",
  "items": [{ /* 问题1 */ }, { /* 问题2 */ }]
}

## 约束
- 如果内容无法分解为独立问题（如过于模糊、只有一句话），设置 decomposable 为 false
- 每条 items 必须符合上述字段结构
- priority 必须是 P0/P1/P2/P3 之一
- type 必须是 bug/feature/refactor/docs/test/research 之一
- title 必须以动词开头，10-50 字符
- 只输出 JSON`,
  en: `You are a professional requirements/problem analysis expert.

## Task
Analyze user input content and decompose it into a list of independent problems or requirements.

## Decomposition Rules
1. If it's a single clear requirement, return a list with 1 element
2. If it's an investigation report format (containing "Problem X", "### Phenomenon" sections), extract all problems
3. If it's a complex requirement, split into independently completable sub-requirements

## Required Fields for Each Problem/Requirement
{
  "title": "Concise title (starts with verb, 10-50 characters)",
  "problem": "Problem description: phenomenon, background, impact (≥50 characters)",
  "rootCause": "Root cause analysis: why this problem occurred (≥30 characters, optional)",
  "solution": "Solution: how to solve this problem, specific steps (≥50 characters)",
  "priority": "P0 | P1 | P2 | P3",
  "type": "bug | feature | refactor | docs | test | research",
  "checkpoints": ["Verification step 1", "Verification step 2"]
}

## Output Format
{
  "decomposable": true | false,
  "reason": "Reason for decomposition failure",
  "items": [{ /* Problem 1 */ }, { /* Problem 2 */ }]
}

## Constraints
- If content cannot be decomposed into independent problems (too vague, only one sentence), set decomposable to false
- Each items entry must conform to the field structure above
- Priority must be one of P0/P1/P2/P3
- Type must be one of bug/feature/refactor/docs/test/research
- Title must start with a verb, 10-50 characters
- Output JSON only`,
};

/**
 * Bug Report Default Template
 * @source ai-metadata.ts buildBugReportPrompt()
 */
export const DEFAULT_BUG_REPORT_TEMPLATE: PromptTemplate = {
  zh: `你是一个 Bug 分析助手。将以下 Bug 报告转为结构化需求文档。

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
- 只输出 JSON`,
  en: `You are a Bug analysis assistant. Convert the following Bug report into a structured requirement document.

## Bug Report
{reportContent}
{logContextSection}
## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.
If a field cannot be determined, set it to null rather than guessing.

## Output Format
{
  "title": "Title starting with verb",
  "description": "Structured description: background, reproduction steps, expected behavior, actual behavior",
  "type": "bug | feature | null",
  "priority": "P0 | P1 | P2 | P3 | null",
  "checkpoints": ["List of verification steps or null"],
  "rootCause": "Root cause analysis or null",
  "impactScope": "Impact scope or null"
}

## Constraints
- Title must start with a verb
- Each checkpoint must start with a verb
- Output JSON only`,
};

/**
 * Semantic Dependency Inference Default Template
 * @source ai-metadata.ts buildSemanticDependencyPrompt()
 */
export const DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE: PromptTemplate = {
  zh: `你是一个项目管理助手。分析以下任务列表，推断任务间的语义依赖关系。

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
- 只输出 JSON`,
  en: `You are a project management assistant. Analyze the following task list and infer semantic dependency relationships between tasks.

## Task List
{taskList}

## Output Requirements
Output pure JSON object, do not wrap in markdown code blocks.

Analyze the functional semantics in each task's title and description to infer implicit dependency relationships between tasks.
For example:
- Login functionality depends on user model definition
- API endpoints depend on database schema
- Utility functions depend on type definitions
- Test tasks depend on the implementation being tested

## Output Format
{
  "dependencies": [
    {
      "taskId": "Dependent task ID",
      "depTaskId": "Dependency task ID",
      "reason": "Reason for inferred dependency"
    }
  ]
}

## Constraints
- Only infer semantically reasonable dependencies, do not infer dependencies already detected through file overlap
- taskId must depend on depTaskId (the task corresponding to depTaskId should be completed first)
- reason must explain the semantic basis for the inference
- If no semantic dependencies are found, return empty array
- Output JSON only`,
};

// ============================================================
// Default Template Registry
// ============================================================

/**
 * Registry of all default templates
 * Keys are template names, values are default template records
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
  decomposition: DEFAULT_DECOMPOSITION_TEMPLATE,
};

// ============================================================
// loadPromptTemplate - Configuration Loading Function
// ============================================================

/**
 * Load prompt template.
 *
 * Priority: User custom config > Built-in default templates.
 *
 * 1. Read user custom template from config.json prompts.customTemplates.{name} or prompts.{name} (backward compatibility)
 * 2. If exists, return user custom template
 * 3. Otherwise return built-in default template for the specified language
 *
 * @param name - Template name
 * @param cwd - Working directory (for locating config.json)
 * @param language - Language code ('zh' | 'en'), defaults to prompts.language or global language or 'en' if not specified
 * @returns Template string for the specified language
 *
 * @example
 * // With custom config, returns custom template
 * loadPromptTemplate('dev', cwd) // => User's custom development template
 *
 * // Without config, returns default template
 * loadPromptTemplate('qa', cwd)  // => DEFAULT_QA_TEMPLATE[language]
 */
export function loadPromptTemplate(
  name: PromptTemplateName,
  cwd?: string,
  language?: Language
): string {
  const config = cwd ? readConfig(cwd) : null;
  const prompts = config?.prompts as Record<string, unknown> | undefined;

  // Check for custom template (new format: prompts.customTemplates.{name})
  if (prompts?.customTemplates && typeof prompts.customTemplates === 'object') {
    const customTemplates = prompts.customTemplates as Record<string, string>;
    if (typeof customTemplates[name] === 'string') {
      // Determine language for custom template: parameter > prompts.language > global language > 'en'
      const lang: Language = language || (prompts.language as Language) || (config?.language as Language) || 'en';
      // Custom templates are language-agnostic, return as-is
      return customTemplates[name]!;
    }
  }

  // Check for custom template (backward compatibility: prompts.{name})
  if (prompts && typeof prompts[name] === 'string') {
    return prompts[name] as string;
  }

  // Determine language: parameter > prompts.language > global language > 'en'
  const lang: Language = language || (prompts?.language as Language) || (config?.language as Language) || 'en';

  // Return the template for the specified language
  const template = DEFAULT_TEMPLATES[name];
  return template[lang] || template.en;
}

/**
 * Valid phase names for customRequirements
 */
export type CustomRequirementsPhase = 'dev' | 'codeReview' | 'qa' | 'evaluation';

/**
 * Load custom requirements for a specific phase.
 *
 * Reads user-defined requirements from config.json prompts.customRequirements.{phase}
 * and formats them with an i18n title prefix.
 *
 * Language priority: parameter > config.prompts.language > config.language > 'en'
 *
 * @param phase - Phase name (dev, codeReview, qa, evaluation)
 * @param cwd - Working directory (for locating config.json)
 * @param language - Language code ('zh' | 'en')
 * @returns Formatted custom requirements section, or empty string if not configured
 *
 * @example
 * // With config: { prompts: { customRequirements: { dev: "Focus on performance" } } }
 * loadCustomRequirements('dev', cwd) // => "## 定制需求\nFocus on performance\n"
 *
 * // Without config
 * loadCustomRequirements('dev', cwd) // => ""
 */
export function loadCustomRequirements(
  phase: CustomRequirementsPhase,
  cwd?: string,
  language?: Language
): string {
  const config = cwd ? readConfig(cwd) : null;
  const prompts = config?.prompts as Record<string, unknown> | undefined;

  // Get customRequirements object
  const customRequirements = prompts?.customRequirements as Record<string, string> | undefined;
  if (!customRequirements) {
    return '';
  }

  // Get the requirement for the specified phase
  const requirement = customRequirements[phase];
  if (!requirement || requirement.trim() === '') {
    return '';
  }

  // Determine language: parameter > prompts.language > global language > 'en'
  const lang: Language = language || (prompts?.language as Language) || (config?.language as Language) || 'en';

  // Get i18n texts for the determined language
  const i18n = getI18n(lang);

  // Format with i18n title prefix
  const title = i18n.harness.customRequirements;

  return `## ${title}\n${requirement.trim()}\n`;
}

