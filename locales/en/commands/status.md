# Status Command - Display Project Status

Display project status summary.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js status [options]
```

## Options

- `--archived` - Show archived task statistics
- `-a, --all` - Show all tasks (including archived)
- `-q, --quiet` - Compact output: key metrics only
- `--json` - JSON format output
- `--compact` - Use compact separators

## Output

```
📊 Project Status Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tasks: 5 total
  ⬜ Open: 2
  🔄 In Progress: 1
  ✅ Resolved: 2

Plan: 3 tasks queued

Branch: feature/task-001
```

## Examples

### View Current Status
```bash
projmnt4claude status
```

### Include Archived Tasks
```bash
projmnt4claude status --all
projmnt4claude status --archived
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/status.md
