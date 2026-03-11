# Analyze Command - Project Health Analysis

Analyze project health status and detect issues.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js analyze [options]
```

## Options

- `--fix` - Automatically fix detected issues

## Checks Performed

1. **Task Integrity** - Verify task files are valid
2. **Dependency Validity** - Check dependency references exist
3. **Archive Consistency** - Verify archived tasks are properly stored
4. **Config Validity** - Check configuration file format

## Examples

### Analyze Project
```bash
projmnt4claude analyze
```

### Analyze and Fix Issues
```bash
projmnt4claude analyze --fix
```

## Output Example

```
🔍 Project Health Analysis
━━━━━━━━━━━━━━━━━━━━━━━

✅ Tasks: 5 valid
✅ Dependencies: All references valid
⚠️ Config: Missing 'projectName' field

💡 Run 'analyze --fix' to auto-fix issues
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/analyze.md
