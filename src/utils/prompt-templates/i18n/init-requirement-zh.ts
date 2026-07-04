/**
 * init-requirement 模板中文版本
 *
 * 3 个模板：
 * - report-to-task: 报告 → 任务元数据提取
 * - taskFix: 门禁失败 → 任务元数据修复
 * - aiAlignmentCheck: AI 对齐验证
 */

export const initRequirementTemplates: Record<string, string> = {
  reportToTask: `你是 projmnt4claude 项目的任务创建助手。

## 任务
根据以下调查报告，生成创建任务所需的完整元数据结构（JSON 格式）。

## 调查报告
{report}

## 检查点前缀映射规则
{prefixMap}

## 输出要求
请输出一个完整的 JSON 对象，包含以下字段：

\`\`\`json
{
  "title": "任务标题（从报告标题提取）",
  "type": "bug|feature|research|docs|refactor|test",
  "priority": "P0|P1|P2|P3",
  "description": "完整的任务描述，必须包含: ## 原因分析\\n{对应报告CA章节}\\n\\n## 解决方案\\n{对应报告SOL章节}",
  "checkpoints": [
    {
      "prefix": "ai-review|ai-qa|human-qa|script",
      "description": "检查点描述（去除前缀后的纯文本）",
      "category": "按 PREFIX_MAP 推断",
      "verificationMethod": "按 PREFIX_MAP 推断"
    }
  ],
  "files": ["从报告解决方案章节提取的涉及文件路径"],
  "estimatedMinutes": "预估工时（数字）",
  "dependencies": ["依赖的报告相对路径，如无可为空数组"]
}
\`\`\`

## 约束
- 检查点必须从报告的「检查点覆盖清单」章节提取
- 每个检查点必须包含标准前缀 [ai review]/[ai qa]/[human qa]/[script]
- 按照 PREFIX_MAP 正确设置 category 和 verificationMethod
- description 必须包含「原因分析」和「解决方案」两个章节
- 输出纯 JSON，不要包含 markdown 代码块标记`,

  taskFix: `你是 projmnt4claude 项目的任务元数据修复助手。

## 任务
以下任务未通过质量门禁，请根据失败原因修正任务元数据。

## 当前任务元数据（meta.json）
{currentMeta}

## 门禁失败原因
{gateErrors}

## 质量评分详情
{qualityIssues}

## 对齐验证失败项（如有）
{alignmentIssues}

## 修正要求
请输出修正后的完整任务元数据 JSON，保持原有结构，仅修改失败项相关的字段:

1. 如果检查点缺少前缀 → 补充标准前缀
2. 如果 category 不正确 → 按 PREFIX_MAP 修正
3. 如果 verification.commands 为空 → 根据检查点前缀 + 任务 files 生成
4. 如果 description 缺少章节 → 补充完整的「原因分析」和「解决方案」
5. 如果对齐验证失败 → 根据 alignmentIssues 中的具体描述修正对应章节
6. 如果评分过低 → 提升对应维度的内容质量

## 输出格式
输出修正后的完整 meta.json JSON 对象，保持所有原有字段不变，仅修改需要修正的部分。`,

  aiAlignmentCheck: `你是 projmnt4claude 项目的任务对齐验证助手。

## 任务
对比以下调查报告和已创建的任务元数据，判断两者是否对齐。

## 调查报告
{report}

## 任务元数据（meta.json）
{taskMeta}

## 对齐验证维度
1. **原因分析对齐**: 任务 description 中的「原因分析」章节是否覆盖了报告的所有 CA-xxx 条目
2. **解决方案对齐**: 任务 description 中的「解决方案」章节是否覆盖了报告的所有 SOL-xxx 条目
3. **检查点对齐**: 任务 checkpoints 数量和内容是否与报告的「检查点覆盖清单」一致

## 输出格式
\`\`\`json
{
  "aligned": true或false,
  "checks": {
    "rootCauseAlignment": { "passed": true或false, "detail": "具体描述" },
    "solutionAlignment": { "passed": true或false, "detail": "具体描述" },
    "checkpointAlignment": { "passed": true或false, "detail": "具体描述" }
  },
  "issues": ["不对齐项的描述列表，aligned=true时为空数组"]
}
\`\`\``,
};
