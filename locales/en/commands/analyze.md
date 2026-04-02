# Analyze Command - Project Health Analysis

Analyze project health status, detect issues, and optionally fix them.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze [options]
```

## Options

| Option | Description | Default | Recommended |
|--------|-------------|---------|-------------|
| `--fix` | Auto-fix all fixable issues | - | User/AI |
| `--fix-checkpoints` | Smart-generate missing checkpoints | - | User/AI |
| `--fix-verification` | Fix verification method issues (manual -> automated) | - | AI |
| `--fix-status` | Fix status-related issues (format, priority, timestamps, etc.) | - | AI |
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
7. **Verification Method** - Flag manual verification (deprecated)
8. **Content Quality** - Score description completeness, checkpoint quality, related files, solution

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

### Fix Verification Methods Only
```bash
projmnt4claude analyze --fix-verification -y
```

### Fix Status Issues Only
```bash
projmnt4claude analyze --fix-status -y
```

### Content Quality Check
```bash
projmnt4claude analyze --quality-check
projmnt4claude analyze --quality-check --threshold 70 --json
```

## Output Example

```
🔍 Project Health Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tasks: 5 valid
✅ Dependencies: All references valid
⚠️ Config: Missing 'projectName' field

💡 Run 'analyze --fix' to auto-fix issues
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/analyze.md
