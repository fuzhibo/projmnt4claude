# Analyze Command - Project Health Analysis

Analyze project health status, detect issues, and optionally fix them.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze [options]
```

## Options

| Option | Description | Default | Recommended |
|--------|-------------|---------|-------------|
| `--fix` | Auto-fix all fixable issues (schema migration, deprecated statuses, field completeness, etc.) | - | User/AI |
| `--fix-checkpoints` | Smart-generate missing checkpoints | - | User/AI |
| `--quality-check` | Check task content quality (description, checkpoints, files, solution) | - | User/AI |
| `--threshold <score>` | Quality threshold; tasks below this score are flagged | 60 | User/AI |
| `-j, --json` | JSON output (only with --quality-check) | false | AI |
| `-y, --yes` | Non-interactive mode: auto-fix without confirmation | false | AI |
| `--compact` | Use compact separators | false | AI |
| `--task <taskId>` | Target task ID (only with --fix-checkpoints) | - | AI |

## Checks Performed

1. **Task Integrity** - Verify task files are valid
2. **Dependency Validity** - Check dependency references exist
3. **Archive Consistency** - Verify archived tasks are properly stored
4. **Config Validity** - Check configuration file format
5. **Schema Compliance** - Validate status, priority, type, timestamps against spec
6. **Relationship Integrity** - Validate parent-child and dependency references
7. **Deprecated Status Detection** - Flag reopened/needs_human (deprecated in v4) and auto-migrate
8. **Field Completeness** - Ensure transitionNotes, schemaVersion, and other v4+ fields are initialized
9. **Verification Method** - Flag manual verification (deprecated)
10. **Content Quality** - Score description completeness, checkpoint quality, related files, solution

## Auto-fix Capabilities (`--fix`)

The `--fix` flag handles all fixable issues in a single pass:

- **Schema migration**: Upgrades tasks from any schema version to the current version
- **Deprecated status migration**: `reopened` → `open` (with reopenCount tracking), `needs_human` → `open` (with resumeAction)
- **Field initialization**: Adds missing transitionNotes, reopenCount, requirementHistory, etc.
- **Priority normalization**: Converts old format (urgent/high/medium/low) to new (P0-P3)
- **Status normalization**: Converts old format (pending/completed/cancelled) to current
- **Pipeline state migration**: Migrates intermediate pipeline statuses
- **Invalid reference cleanup**: Removes invalid dependency/subtask references
- **Verification backfill**: Auto-generates verification data for resolved tasks missing it
- **Inconsistent state repair**: Fixes resolved tasks with failed verification

### Post Processing

After checkpoints complete:
1. Run `analyze --fix -y` to sync all detected issues
2. Run `doctor --fix` to verify project-level health
3. The `--fix` flag automatically handles deprecated status cleanup and field migration

## Examples

### Analyze Project
```bash
projmnt4claude analyze
```

### Analyze and Fix All Issues
```bash
projmnt4claude analyze --fix -y
```

### Generate Missing Checkpoints
```bash
projmnt4claude analyze --fix-checkpoints -y
```

### Content Quality Check
```bash
projmnt4claude analyze --quality-check
projmnt4claude analyze --quality-check --threshold 70 --json
```

## Valid Task Statuses

| Status | Description |
|--------|-------------|
| `open` | Task is pending (includes reopened tasks, tracked via reopenCount) |
| `in_progress` | Task is actively being worked on |
| `wait_review` | Awaiting code review (pipeline intermediate) |
| `wait_qa` | Awaiting QA verification (pipeline intermediate) |
| `wait_complete` | Awaiting completion confirmation (pipeline intermediate) |
| `resolved` | Task completed and verified |
| `closed` | Task closed (terminal state) |
| `abandoned` | Task abandoned (terminal state) |

> **Note**: `reopened` and `needs_human` were deprecated in schema v4. Tasks previously using these statuses are migrated to `open` with appropriate tracking fields (reopenCount, resumeAction, transitionNotes).

## Output Example

```
🔍 Project Health Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tasks: 5 valid
✅ Dependencies: All references valid
⚠️ Config: Missing 'projectName' field

💡 Run 'analyze --fix' to auto-fix issues
```
