# Task Command - Manage Project Tasks

Create, view, update, and execute tasks.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js task <action> [options]
```

## Available Actions

| Action | Description | Example |
|--------|-------------|---------|
| `create` | Create new task interactively | `task create` |
| `list` | List all tasks | `task list --status in_progress` |
| `show` | Display task details | `task show TASK-001` |
| `update` | Update task properties | `task update TASK-001 --status resolved` |
| `delete` | Delete (archive) task | `task delete TASK-001` |
| `execute` | Guide task execution | `task execute TASK-001` |
| `checkpoint` | Complete checkpoint | `task checkpoint TASK-001` |
| `dependency` | Manage dependencies | `task dependency add TASK-001 TASK-002` |
| `add-subtask` | Create subtask for parent task | `task add-subtask TASK-001 "Implement login feature"` |

## Filter Options (list)
- `--status <status>` - Filter by status
- `--priority <priority>` - Filter by priority
- `--role <role>` - Filter by recommended role

## Update Options (update)
- `--title <title>` - Update title
- `--description <desc>` - Update description
- `--status <status>` - Update status
- `--priority <priority>` - Update priority

## Checkpoint Workflow

Complete checkpoints to progress task:

```bash
# Complete checkpoint
projmnt4claude task checkpoint TASK-001

# Verify checkpoint (generates token)
projmnt4claude task checkpoint TASK-001 verify

# Update task status with token
projmnt4claude task update TASK-001 --status resolved --token <token>
```

## Subtask Management

### Create Subtask
```bash
projmnt4claude task add-subtask TASK-001 "Subtask title"
```

### View Subtasks
```bash
projmnt4claude task show TASK-001
projmnt4claude task list
```

### Subtask Hierarchy Display
`task list` command automatically displays parent-child task hierarchy:
```
TASK-001    Parent task title [2 subtasks]
  └─ TASK-001-1  Subtask 1
  └─ TASK-001-2  Subtask 2
```

## Dependency Management

### Add Dependency
```bash
projmnt4claude task dependency add TASK-001 --dep-id TASK-002
```

### Remove Dependency
```bash
projmnt4claude task dependency remove TASK-001 --dep-id TASK-002
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/task.md
