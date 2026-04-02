# Plan Command - Manage Execution Plans

Manage task execution order and scheduling.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js plan <action> [options]
```

## Available Actions

| Action | Description |
|--------|-------------|
| `show` | Display current execution plan |
| `add` | Add task to plan |
| `remove` | Remove task from plan |
| `clear` | Clear entire plan |
| `recommend` | Smart task recommendations |

## Options

- `-j, --json` - Output as JSON (show/recommend)
- `-f, --force` - Skip confirmation (clear only)
- `-a, --after <taskId>` - Add after specified task (add only)
- `-y, --yes` - Non-interactive, auto-apply recommendations (recommend only)
- `-q, --query <query>` - Filter by user description/keywords (recommend only)
- `--all` - Show all status tasks, default only open (recommend only)

## Examples

### View Plan
```bash
projmnt4claude plan show
projmnt4claude plan show --json
```

### Add Task to Plan
```bash
projmnt4claude plan add TASK-001
projmnt4claude plan add TASK-002 --after TASK-001
```

### Remove Task from Plan
```bash
projmnt4claude plan remove TASK-001
```

### Clear Plan
```bash
projmnt4claude plan clear
projmnt4claude plan clear --force
```

### Get Recommendations
```bash
projmnt4claude plan recommend
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/plan.md
