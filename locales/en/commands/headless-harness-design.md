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
| `--skip-quality-gate` | Skip quality gate check (not recommended) | false |

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
3. **Review Phase** - Independently verify development results
4. **Generate Report** - Output execution summary

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

## Output

- `.projmnt4claude/reports/harness/summary-{timestamp}.md` - Execution summary
- `.projmnt4claude/reports/harness/{taskId}/dev-report.md` - Development report
- `.projmnt4claude/reports/harness/{taskId}/review-report.md` - Review report
