/**
 * init-requirement 模板英文版本
 *
 * 3 个模板：
 * - reportToTask: Report → Task metadata extraction
 * - taskFix: Gate failure → Task metadata fix
 * - aiAlignmentCheck: AI alignment verification
 */

export const initRequirementTemplates: Record<string, string> = {
  reportToTask: `You are a task creation assistant for the projmnt4claude project.

## Task
Generate a complete task metadata structure (JSON format) based on the following investigation report.

## Investigation Report
{report}

## Checkpoint Prefix Mapping Rules
{prefixMap}

## Output Requirements
Output a complete JSON object with the following fields:

\`\`\`json
{
  "title": "Task title (extracted from report title)",
  "type": "bug|feature|research|docs|refactor|test",
  "priority": "P0|P1|P2|P3",
  "description": "Full task description, must include: ## Root Cause Analysis\\n{map report CA sections}\\n\\n## Solution\\n{map report SOL sections}",
  "checkpoints": [
    {
      "prefix": "verify|test|review|implem|doc",
      "description": "Checkpoint description (plain text without prefix)",
      "category": "Inferred from PREFIX_MAP",
      "verificationMethod": "Inferred from PREFIX_MAP"
    }
  ],
  "files": ["File paths extracted from report solution sections"],
  "estimatedMinutes": "Estimated hours (number)",
  "dependencies": ["Dependent report relative paths, empty array if none"]
}
\`\`\`

## Constraints
- Checkpoints MUST be extracted from the report's "Checkpoint Checklist" section
- Each checkpoint MUST include a standard prefix: [verify]/[test]/[review]/[implem]/[doc]
- Correctly set category and verificationMethod according to PREFIX_MAP
- description MUST include both "Root Cause Analysis" and "Solution" sections
- Output pure JSON only, do NOT include markdown code block markers`,

  taskFix: `You are a task metadata repair assistant for the projmnt4claude project.

## Task
The following task failed the quality gate. Fix the task metadata based on the failure reasons.

## Current Task Metadata (meta.json)
{currentMeta}

## Gate Failure Reasons
{gateErrors}

## Quality Score Details
{qualityIssues}

## Alignment Verification Failures (if any)
{alignmentIssues}

## Fix Requirements
Output the corrected full task metadata JSON. Keep the existing structure, only modify fields related to failures:

1. If checkpoints are missing prefixes → add standard prefixes
2. If category is incorrect → correct according to PREFIX_MAP
3. If verification.commands is empty → generate based on checkpoint prefix + task files
4. If description is missing sections → add complete "Root Cause Analysis" and "Solution" sections
5. If alignment verification failed → fix corresponding sections based on alignmentIssues
6. If quality score is too low → improve content quality for the relevant dimensions

## Output Format
Output the corrected full meta.json JSON object. Keep all existing fields unchanged, only modify what needs fixing.`,

  aiAlignmentCheck: `You are a task alignment verification assistant for the projmnt4claude project.

## Task
Compare the following investigation report with the created task metadata to determine whether they are aligned.

## Investigation Report
{report}

## Task Metadata (meta.json)
{taskMeta}

## Alignment Verification Dimensions
1. **Root Cause Alignment**: Does the "Root Cause Analysis" section in the task description cover all CA-xxx entries in the report?
2. **Solution Alignment**: Does the "Solution" section in the task description cover all SOL-xxx entries in the report?
3. **Checkpoint Alignment**: Do the task checkpoints match the report's "Checkpoint Checklist" in both count and content?

## Output Format
\`\`\`json
{
  "aligned": true or false,
  "checks": {
    "rootCauseAlignment": { "passed": true or false, "detail": "specific description" },
    "solutionAlignment": { "passed": true or false, "detail": "specific description" },
    "checkpointAlignment": { "passed": true or false, "detail": "specific description" }
  },
  "issues": ["List of misalignment descriptions, empty array when aligned=true"]
}
\`\`\``,
};
