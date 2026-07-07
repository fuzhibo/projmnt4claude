/**
 * Investigation 模板英文版本
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
  investigate: `You are a requirement investigation analyst for the projmnt4claude project.

## Task
Generate a structured investigation report based on the following requirement description.

## Requirement Description
{requirement}

## Project Context
{projectContext}

## Layout Hierarchy Constraints (Must Strictly Follow)
- Title hierarchy: # Level 1 → ## Level 2 → ### Level 3, no skipping
- Section numbering: Use CA-NNN / SOL-NNN format (e.g., CA-001, SOL-001), consistent with parser contract
- Numbering explanation: CA-NNN for Cause Analysis, SOL-NNN for Solution
- List hierarchy: Use 2-space indentation, max 3 levels nested
- Code blocks: Must specify language type
- Tables: Must have header row, columns aligned
- Checkpoints: Must use [prefix] standard prefix format

## ⚠️ Important: You MUST strictly follow this output format

Below is a complete output format example, please follow it strictly:

---

# Investigation Report: {title}

## ${REPORT_SECTIONS.metadata.en}
- **${METADATA_FIELDS.requirementSource.en}**: {requirement}
- **${METADATA_FIELDS.investigationDate.en}**: {date}
- **${METADATA_FIELDS.investigationDir.en}**: investigation-{slug}
- **${METADATA_FIELDS.language.en}**: en

## ${REPORT_SECTIONS.rootCauseAnalysis.en}
### ${buildCaId(1)}: {Root cause title}
{Root cause detailed description}

## ${REPORT_SECTIONS.solutions.en}
### ${buildSolId(1)}: {Solution title} → Corresponds to ${buildCaId(1)}
{Solution detailed description}
- ${SOLUTION_FIELDS.files.en}: \`src/path/to/file.ts\`
- ${SOLUTION_FIELDS.expectedChanges.en}: {Change description}

## ${REPORT_SECTIONS.checkpoints.en}
### ${buildSolId(1)} Related Checkpoints
- [ai review] Verify solution design meets requirements → ${buildSolId(1)}
- [ai qa] Test core functionality works correctly → ${buildSolId(1)}
- [script] Run unit tests to ensure no regression → ${buildSolId(1)}

## ${REPORT_SECTIONS.assessment.en}
- ${ASSESSMENT_FIELDS.complexity.en}: {low|medium|high}
- ${ASSESSMENT_FIELDS.impactScope.en}: {limited|moderate|extensive}
- ${ASSESSMENT_FIELDS.estimatedMinutes.en}: {N} minutes
---

**Notes**:
1. You MUST fill in all placeholders: {title}, {requirement}, {slug}, {date}, etc.
2. Root cause analysis MUST use CA-NNN numbering format
3. Solutions MUST use SOL-NNN numbering format
4. Checkpoints MUST annotate the solution number they belong to (format: → SOL-NNN)
5. Each section MUST have substantive content; do not leave any section empty
6. Root cause analysis must trace back to the requirement, ensuring a complete "requirement→cause" chain
7. Solutions must correspond one-to-one with each conclusion in the root cause analysis
8. Checkpoints must cover every key point in the solution
9. Checkpoint format: '- [prefix] description → SOL-NNN'
10. Use standard gate prefixes for checkpoints: [ai review], [ai qa], [human qa], [script]
11. Numbering format: CA-NNN (Cause Analysis), SOL-NNN (Solution), NNN is at least 3 digits
`,

  review: `You are an investigation report quality reviewer for the projmnt4claude project.

## Task
Review the quality of the following investigation report across three dimensions.

## Original Requirement
{requirement}

## Investigation Report
{report}

## Layout Hierarchy Constraints (Check During Review)
- Title hierarchy: # Level 1 → ## Level 2 → ### Level 3, no skipping
- Section numbering: Use CA-NNN / SOL-NNN format (e.g., CA-001, SOL-001), consistent with parser contract
- List hierarchy: Use 2-space indentation, max 3 levels nested
- Code blocks: Must specify language type
- Tables: Must have header row, columns aligned
- Checkpoints: Must use [prefix] standard prefix format

## Review Criteria

### Dimension 1: Root Cause Alignment
- Does the root cause analysis comprehensively cover all key points in the user's requirement?
- Are there any missing requirement dimensions?
- Is the root cause reasoning logically consistent?

### Dimension 2: Solution Effectiveness
- Does each solution correspond one-to-one with each conclusion in the root cause analysis?
- Can the solutions genuinely address the user's requirement?
- Are there any cases where solutions do not correspond to root causes?

### Dimension 3: Checkpoint Completeness
- Do the checkpoints cover all key points in the solution?
- Are the checkpoint verification methods specific and executable?
- Do the checkpoints use standard prefix categorization?

## Output Format
\`\`\`json
{
  "pass": true or false,
  "scores": {
    "rootCauseAlignment": 0-100,
    "solutionEffectiveness": 0-100,
    "checkpointCompleteness": 0-100
  },
  "issues": [
    {
      "dimension": "rootCauseAlignment|solutionEffectiveness|checkpointCompleteness",
      "severity": "critical|major|minor",
      "description": "Problem description",
      "suggestion": "Improvement suggestion"
    }
  ]
}
\`\`\`

## Pass Criteria
- All dimension scores >= 70 and no critical issues → pass: true
- Any dimension score < 70 or critical issues exist → pass: false
`,

  investigateWithFeedback: `You are a requirement investigation analyst for the projmnt4claude project.

## Task
Revise the following investigation report based on user feedback.

## Original Requirement
{requirement}

## Current Investigation Report
{currentReport}

## User Feedback
{feedback}

## Revision Guidelines
- Address the issues raised in the feedback in the corresponding sections of the report
- Keep the overall report structure unchanged
- Add a [Revised: {date}] marker at the end of revised sections
- If feedback involves new root causes or solutions, append them in the corresponding sections

## Layout Hierarchy Constraints (Must Strictly Follow)
- Title hierarchy: # Level 1 → ## Level 2 → ### Level 3, no skipping
- Section numbering: Use CA-NNN / SOL-NNN format (e.g., CA-001, SOL-001), consistent with parser contract
- List hierarchy: Use 2-space indentation, max 3 levels nested
- Code blocks: Must specify language type
- Tables: Must have header row, columns aligned
- Checkpoints: Must use [prefix] standard prefix format

## Output Format
(Same as the investigate template)
`,

  split: `You are a requirement decomposition analyst for the projmnt4claude project.

## Task
Split the following investigation report into independent sub-problem/sub-requirement reports.

## Original Report
{report}

## Current Split Threshold
{splitThreshold} KB

## Split Guidelines

### Sub-Problem Relationship Types
Two relationship types exist between sub-problems:
1. **Parallel**: Items are categorized by theme/module with no ordering dependencies. Can be processed concurrently.
2. **Hierarchical**: Items have layered dependencies. dependsOn reflects the hierarchy. Must be processed in order.
Each item MUST specify its \`relationship\` type.

### dependsOn Constraints
- dependsOn is critical for representing hierarchical structure
- Parallel items: dependsOn is an empty array
- Hierarchical items: base layers first (empty dependsOn), upper layers depend on base (specify base index in dependsOn)

### Forbidden Split Pattern
**DO NOT** split by execution phase (development→review→verification→evaluation).
Each sub-report must be a self-contained closed loop (root cause analysis, solution design, checkpoint checklist, assessment).
Do not distribute phases of the closed loop across different sub-reports.

### Size Control
Each sub-item's estimated size should stay within the {splitThreshold} KB threshold. Estimates exceeding 1.5x the threshold will be flagged as oversized.

## Output Format
\`\`\`json
{
  "items": [
    {
      "title": "Sub-problem title",
      "relationship": "parallel|hierarchical",
      "scope": "Scope description",
      "description": "Detailed description with original requirement mapping",
      "estimatedSize": "estimated size in KB",
      "dependsOn": ["indices of dependent sub-items, 0-based. Empty array for parallel type"]
    }
  ]
}
\`\`\`
`,

  splitReview: `You are a split plan quality reviewer for the projmnt4claude project.

## Task
Review the following split plan against split requirements across six dimensions.

## Original Report
{report}

## Split Plan
{splitPlan}

## Current Split Threshold
{splitThreshold} KB

## Review Criteria

### Dimension 1: Coverage Completeness
- Do the sub-items completely cover all requirements/problems in the original report?
- Are there any missing requirement dimensions or solutions?

### Dimension 2: Boundary Clarity
- Is there any overlap or ambiguity in scope between sub-items?
- Is each sub-item's boundary clearly defined?

### Dimension 3: Independence
- Can each sub-item be understood and implemented independently (as a self-contained closed loop with root cause analysis, solutions, checkpoints, and assessment)?
- Are there any unreasonable couplings?

### Dimension 4: Dependency Reasonability
- Are the dependsOn dependencies real and necessary?
- Are there any circular dependencies?
- Is the relationship type (parallel vs hierarchical) accurately labeled?

### Dimension 5: Anti-Phase-Splitting (One-Vote Veto)
- **Strict check**: Are there any sub-items split by execution phase (development→review→verification→evaluation)?
- Each sub-report MUST be a self-contained closed loop. Do not distribute phases across different sub-reports.
- If found → immediate FAIL, severity = critical.

### Dimension 6: Appropriate Granularity
- Is each sub-item's estimated size within a reasonable range of the {splitThreshold} KB threshold?
- Are there any items that are oversized (estimated > 1.5x threshold) or undersized?
- Note: granularity is a warning-level check, not a hard block. Actual recursive splitting is triggered by the generated sub-report file size.

## Output Format
\`\`\`json
{
  "pass": true or false,
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
      "description": "Problem description",
      "suggestion": "Improvement suggestion"
    }
  ]
}
\`\`\`

## Pass Criteria
- All dimension scores >= 70 and no critical issues → pass: true
- Any dimension score < 70 or critical issues exist → pass: false
`,
};