---
description: "Harness Design mode execution - automated task development and review workflow"
argument-hint: "[options]"
---

# headless-harness-design Command

Execute tasks using Harness Design mode for automated development and review.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js headless-harness-design [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--plan <file>` | Plan file path (optional; auto-read/generate if not specified) | auto |
| `--max-retries <n>` | Maximum retry count per task | 3 |
| `--timeout <seconds>` | Timeout per task (seconds) | 300 |
| `--parallel <n>` | Parallel execution count | 1 |
| `--dry-run` | Dry-run mode (no actual execution) | false |
| `--continue` | Resume from last interruption | false |
| `--json` | JSON format output | false |
| `--api-retry-attempts <n>` | API call retry count (for 429/500 errors) | 3 |
| `--api-retry-delay <seconds>` | API retry base delay (seconds) | 60 |
| `--require-quality <n>` | Quality gate: minimum quality score threshold (0-100) | 60 |
| `--skip-harness-gate` | Skip Harness pre-execution quality gate (not recommended, `--skip-quality-gate` is backward-compatible alias) | false |
| `--batch-git-commit` | Auto git commit after each batch completes | false |

## Pipeline Status Query

During or after execution, check pipeline status:

```bash
# Query current pipeline status
cat .projmnt4claude/harness-status.json

# Format with jq
jq '.' .projmnt4claude/harness-status.json

# Current phase only
jq '.currentPhase' .projmnt4claude/harness-status.json

# Progress only
jq '.progress' .projmnt4claude/harness-status.json
```

**Status fields**:
- `state`: Pipeline state (idle/running/completed/failed)
- `currentPhase`: Current phase (development/code_review/qa_verification/evaluation)
- `progress`: Progress percentage (0-100)
- `message`: Status message
- `phaseHistory`: Phase history timeline

## Workflow

1. **Load Plan** - Priority: `--plan` file > `.projmnt4claude/current-plan.json` > auto `plan recommend`
2. **Development Phase** - Execute development work for each task
3. **Code Review Phase** - Independent code review for quality and standards
4. **QA Verification Phase** - Automated testing and functional verification
5. **Evaluation Phase** - Final evaluation against acceptance criteria
6. **Generate Report** - Output execution summary

## Examples

### Direct Execution (Recommended)
```bash
projmnt4claude headless-harness-design
```

### Plan First, Then Execute
```bash
projmnt4claude plan recommend
projmnt4claude headless-harness-design
```

### Dry Run
```bash
projmnt4claude headless-harness-design --dry-run
```

### Resume Interrupted Execution
```bash
projmnt4claude headless-harness-design --continue
```

### With Quality Gate
```bash
projmnt4claude headless-harness-design --require-quality 80
```

### API Retry Configuration
```bash
projmnt4claude headless-harness-design --api-retry-attempts 5 --api-retry-delay 30
```

### Batch Auto Commit
```bash
projmnt4claude headless-harness-design --batch-git-commit
```

When enabled, automatically runs `git add -A` + `git commit` after each batch completes. The commit message includes the batch label and statistics (passed/failed/file changes). Combine with `--dry-run` to preview commit behavior.

### Batch Commit Tracing

With `--batch-git-commit`, a git commit is automatically created after each batch completes, creating a traceable execution history:

- **Commit Format**: `harness: batch N completed (X passed, Y failed, Z file changes)`
- **Tracing**: Use `git log --oneline | grep "harness:"` to view all batch commits
- **Batch Content**: Each commit includes file changes from all tasks in that batch
- **Resume Safety**: `--continue` won't re-commit changes from completed batches
- **Dry-run Preview**: Combine with `--dry-run` to preview commit behavior without executing

## Output

- `.projmnt4claude/reports/harness/summary-{timestamp}.md` - Execution summary
- `.projmnt4claude/reports/harness/{taskId}/dev-report.md` - Development report
- `.projmnt4claude/reports/harness/{taskId}/review-report.md` - Review report

## AI Behavior Guidelines

### Quality Gate (Important)

**Do NOT use `--skip-harness-gate` (or the deprecated `--skip-quality-gate`)**.

`init-requirement` already integrates quality checking (`checkQualityGate`) when creating tasks, displaying quality scores and improvement suggestions for substandard tasks. After quality validation during creation, tasks typically pass the pre-execution quality gate.

Only use `--skip-harness-gate` when explicitly instructed by the user.

## Notes

1. **Auto Plan**: If `--plan` is not specified, the plan is auto-read or generated
2. **Headless Claude**: Requires `claude` CLI installed and authenticated
3. **Timeout**: Complex tasks may need longer timeout values
4. **Parallel**: Currently only serial execution (parallel=1)
5. **Batch Git Commit**: With `--batch-git-commit`, auto git commit after each batch completes. Commit message format: `harness: batch N completed (X passed, Y failed, Z file changes)`. Resuming with `--continue` won't re-commit already-committed batch changes
6. **State File**: `harness-status.json` tracks pipeline state. In batch mode, batch boundaries and progress are tracked. Batch commit failure does not block pipeline execution
