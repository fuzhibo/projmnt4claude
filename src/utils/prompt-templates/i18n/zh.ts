/**
 * Investigation 模板中文版本
 *
 * 5 个模板，3 组：
 * - 调查类: investigate, investigateWithFeedback
 * - 评审类: review
 * - 拆分类: split, splitReview
 *
 * 章节标题、字段标签、编号格式通过引用 report-contract.ts 契约常量生成，
 * 确保模板与解析器契约一致（SOL-001）。
 */
import {
  REPORT_SECTIONS,
  METADATA_FIELDS,
  SOLUTION_FIELDS,
  ASSESSMENT_FIELDS,
  buildCaId,
  buildSolId,
} from '../../investigation/report-contract.js';

export const investigationTemplates: Record<string, string> = {
  investigate: `你是 projmnt4claude 项目的需求调查分析师。

## 任务
根据以下需求描述，生成一份结构化的调查报告。

## 需求描述
{requirement}

## 项目上下文
{projectContext}

{customRequirements}

## 排版层级约束（必须严格遵守）
- 标题层级：# 一级 → ## 二级 → ### 三级，不得跳级
- 章节编号：使用 CA-NNN / SOL-NNN 格式（如 CA-001, SOL-001），与解析器契约一致
- 编号说明：CA-NNN 表示原因分析编号（Cause Analysis），SOL-NNN 表示解决方案编号（Solution）
- 列表层级：缩进使用 2 空格，最多 3 级嵌套
- 代码块：必须标注语言类型
- 表格：必须有表头行，列对齐
- 检查点：必须使用 [prefix] 标准前缀格式

## ⚠️ 重要：必须严格按照以下格式输出

以下是完整的输出格式示例，请严格遵循：

---
# 调查报告：{title}

## ${REPORT_SECTIONS.metadata.zh}
- **${METADATA_FIELDS.requirementSource.zh}**: {requirement}
- **${METADATA_FIELDS.investigationDate.zh}**: {date}
- **${METADATA_FIELDS.investigationDir.zh}**: investigation-{slug}
- **${METADATA_FIELDS.language.zh}**: zh

## ${REPORT_SECTIONS.rootCauseAnalysis.zh}
### ${buildCaId(1)}: <原因标题>
<原因详细描述>

## ${REPORT_SECTIONS.solutions.zh}
### ${buildSolId(1)}: <方案标题> → 对应 ${buildCaId(1)}
<方案详细描述>
- ${SOLUTION_FIELDS.files.zh}: \`src/path/to/file.ts\`
- ${SOLUTION_FIELDS.expectedChanges.zh}: <变更描述>

## ${REPORT_SECTIONS.checkpoints.zh}
### ${buildSolId(1)} 相关检查点
- [ai review] 验证解决方案设计是否符合需求 → ${buildSolId(1)}
- [ai qa] 测试核心功能是否正常工作 → ${buildSolId(1)}
- [script] 运行单元测试确保无回归 → ${buildSolId(1)}

## ${REPORT_SECTIONS.assessment.zh}
- ${ASSESSMENT_FIELDS.complexity.zh}: low|medium|high
- ${ASSESSMENT_FIELDS.impactScope.zh}: 有限|中等|广泛
- ${ASSESSMENT_FIELDS.estimatedMinutes.zh}: {N} 分钟
---

**注意**:
1. 必须填充所有占位符 {title}、{requirement}、{slug}、{date} 等
2. 原因分析必须使用 CA-NNN 编号格式
3. 解决方案必须使用 SOL-NNN 编号格式
4. 检查点必须标注归属的解决方案编号（格式：→ SOL-NNN）
5. 每个章节必须有实质内容，不能为空
6. 原因分析必须追溯到需求本身，确保"需求→原因"链路完整
7. 解决方案必须逐一对应原因分析中的每个结论
8. 检查点必须覆盖解决方案中的每个要点
9. 检查点格式：'- [prefix] 描述 → SOL-NNN'
10. 检查点使用门禁标准前缀: [ai review], [ai qa], [human qa], [script]
11. 编号格式：CA-NNN（原因分析）、SOL-NNN（解决方案），NNN 为至少 3 位数字
`,

  review: `你是 projmnt4claude 项目的调查报告质量评审员。

## 任务
评审以下调查报告的质量，从三个维度进行评估。

## 原始需求
{requirement}

## 调查报告
{report}

{customRequirements}

## 排版层级约束（评审时检查）
- 标题层级：# 一级 → ## 二级 → ### 三级，不得跳级
- 章节编号：使用 CA-NNN / SOL-NNN 格式（如 CA-001, SOL-001），与解析器契约一致
- 列表层级：缩进使用 2 空格，最多 3 级嵌套
- 代码块：必须标注语言类型
- 表格：必须有表头行，列对齐
- 检查点：必须使用 [prefix] 标准前缀格式

## 评审标准

### 维度1: 原因分析对齐度
- 原因分析是否完整覆盖了用户需求中的所有要点？
- 是否存在遗漏的需求维度？
- 原因推导是否逻辑自洽？

### 维度2: 解决方案有效性
- 解决方案是否逐一对应了原因分析中的每个结论？
- 解决方案是否确实能够解决用户的需求？
- 是否存在解决方案与原因不对应的情况？

### 维度3: 检查点完善度
- 检查点是否覆盖了解决方案中的所有要点？
- 检查点的验证方法是否具体且可执行？
- 检查点是否使用了标准前缀分类？

## ⚠️ 重要：输出格式约束

【强制】无论评审结论如何，必须返回 \`\`\`json 代码块包裹的 JSON 格式。
不得使用 Markdown 文本、HTML 或其他格式替代。

## 输出格式
\`\`\`json
{
  "pass": true或false,
  "scores": {
    "rootCauseAlignment": 0-100,
    "solutionEffectiveness": 0-100,
    "checkpointCompleteness": 0-100
  },
  "issues": [
    {
      "dimension": "rootCauseAlignment|solutionEffectiveness|checkpointCompleteness",
      "severity": "critical|major|minor",
      "description": "问题描述",
      "suggestion": "改进建议"
    }
  ]
}
\`\`\`

## ❌ 错误格式示例（以下格式会导致解析失败，严禁使用）

错误示例 1 - Markdown 文本：
\`\`\`
评审完成。调查报告**不合格**，三个核心维度均为 0 分。
原因分析：空
解决方案：空
\`\`\`

错误示例 2 - 混合格式：
\`\`\`
## 评审结果

### 总体结论：**不通过 (pass: false)**

- 原因分析对齐度：0 分
- 解决方案有效性：0 分
- 检查点完善度：0 分
\`\`\`

## 通过标准
- 所有维度分数 >= 70 且无 critical 问题 → pass: true
- 任一维度分数 < 70 或存在 critical 问题 → pass: false
`,

  investigateWithFeedback: `你是 projmnt4claude 项目的需求调查分析师。

## 任务
根据用户反馈，修正以下调查报告。

## 原始需求
{requirement}

## 当前调查报告
{currentReport}

## 用户反馈
{feedback}

{customRequirements}

## 修正指导
- 针对反馈中提到的问题，在报告中对应章节进行修正
- 修正时保持报告整体结构不变
- 在修正的章节末尾添加 [修订: {date}] 标记
- 如果反馈涉及新的原因或解决方案，在对应章节中追加

## 排版层级约束（必须严格遵守）
- 标题层级：# 一级 → ## 二级 → ### 三级，不得跳级
- 章节编号：使用 CA-NNN / SOL-NNN 格式（如 CA-001, SOL-001），与解析器契约一致
- 列表层级：缩进使用 2 空格，最多 3 级嵌套
- 代码块：必须标注语言类型
- 表格：必须有表头行，列对齐
- 检查点：必须使用 [prefix] 标准前缀格式

## 输出格式
（同 investigate 模板）
`,

  split: `你是 projmnt4claude 项目的需求分解分析师。

## 任务
将以下调查报告拆分为多个独立的子问题/子需求调查报告。

## 原始调查报告路径
{reportPath}

**重要**: 请使用 Read 工具读取报告文件内容，然后基于报告内容进行拆分分析。

## 当前拆分阈值
{splitThreshold} KB

{customRequirements}

## 拆分指导

### 子问题关系类型
子问题之间存在两种关系：
1. **并列分类（parallel）**: 按主题/模块分类，子项间无先后依赖，可并行处理
2. **分层依赖（hierarchical）**: 子项间存在上下层依赖，dependsOn 体现层次结构，需按序处理
每个子项必须在 \`relationship\` 字段注明类型。

### dependsOn 约束
- dependsOn 是体现分层结构的关键信息
- 并列分类的子项 dependsOn 为空数组
- 分层依赖的子项：底层在前（dependsOn 为空），上层依赖底层（dependsOn 标注底层 index）

### 禁止的拆分方式
**严禁**按照执行流程的阶段（开发→审核→验证→评估）拆分报告。
每个子报告必须是自身完整的闭环（含原因分析、解决方案、检查点覆盖清单、评估），
不能将闭环的不同阶段分散到不同子报告中。

### 粒度控制
每个子项的预估大小应控制在阈值 {splitThreshold} KB 以内。预估超过阈值 1.5 倍会被标记为粒度过大。

## 输出格式
\`\`\`json
{
  "items": [
    {
      "title": "子问题/子需求标题",
      "relationship": "parallel|hierarchical",
      "scope": "涉及的范围描述",
      "description": "详细描述，包含原始需求映射",
      "estimatedSize": 预估大小(KB),
      "dependsOn": [依赖子项的index，从0开始。parallel类型为空数组]
    }
  ]
}
\`\`\`
`,

  splitReview: `你是 projmnt4claude 项目的拆分方案质量审核员。

## 任务
审核以下拆分方案是否满足拆分要求，从六个维度进行评估。

## 原始调查报告路径
{reportPath}

**重要**: 请使用 Read 工具读取报告文件内容，然后基于报告内容审核拆分方案。

## 拆分方案
{splitPlan}

{customRequirements}

## 当前拆分阈值
{splitThreshold} KB

## 审核标准

### 维度1: 覆盖完整性
- 拆分后的子项是否完整覆盖了原报告中的所有需求/问题？
- 是否存在遗漏的需求维度或解决方案？

### 维度2: 边界清晰性
- 各子项之间的 scope 是否有重叠或模糊地带？
- 每个子项的边界是否明确定义？

### 维度3: 独立性
- 每个子项是否能独立理解和实施（自身包含原因分析、解决方案、检查点、评估的完整闭环）？
- 是否存在不合理的耦合？

### 维度4: 依赖合理性
- dependsOn 标注的依赖关系是否真实存在且必要？
- 是否存在循环依赖？
- relationship 字段标注的类型是否准确（parallel vs hierarchical）？

### 维度5: 反阶段拆分（一票否决）
- **严格检查**：是否存在按执行流程阶段（开发→审核→验证→评估）拆分的子项？
- 每个子报告必须自身是完整闭环，不能将闭环的不同阶段分散到不同子报告中。
- 发现此类拆分 → 直接判定 FAIL，severity = critical。

### 维度6: 粒度适中
- 每个子项的预估大小是否在阈值 {splitThreshold} KB 上下合理范围内？
- 是否存在粒度过大（预估超过阈值 1.5 倍）或过小的子项？
- 注意：粒度检查为 warning 级别，不硬阻断。实际递归拆分由子报告生成后的文件大小触发。

## 输出格式
\`\`\`json
{
  "pass": true或false,
  "scores": {
    "coverage": 0-100,
    "boundaryClarity": 0-100,
    "independence": 0-100,
    "dependencyReasonability": 0-100,
    "antiPhaseSplitting": 0-100,
    "granularity": 0-100
  },
  "issues": [
    {
      "dimension": "coverage|boundaryClarity|independence|dependencyReasonability|antiPhaseSplitting|granularity",
      "severity": "critical|major|minor",
      "description": "问题描述",
      "suggestion": "改进建议"
    }
  ]
}
\`\`\`

## 通过标准
- 所有维度分数 >= 70 且无 critical 问题 → pass: true
- 任一维度分数 < 70 或存在 critical 问题 → pass: false
`,
};