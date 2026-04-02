# Project Management Tool (projmnt4claude)

Manage Claude Code project tasks - create, view, update, and execute tasks.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js <command> [options]
```

## Available Commands

| Command | Description |
|---------|-------------|
| `setup` | Initialize project management environment |
| `task` | Task management (create/list/show/update/delete/execute/checkpoint/dependency/add-subtask) |
| `plan` | Execution plan management (show/add/remove/clear/recommend) |
| `config` | Configuration management (list/get/set) |
| `status` | Display project status summary |
| `analyze` | Analyze project health status |
| `branch` | Git branch integration (checkout/status/create/delete/merge/push/sync) |
| `tool` | Local skill management (list/create/install/remove/deploy/undeploy) |
| `init-requirement` | Create tasks from natural language requirements |
| `help` | Display help information |

## Global Options

| Option | Description |
|--------|-------------|
| `--ai` | AI mode: auto-enable --json output + non-interactive mode + compact logging |
| `--json` | JSON format output (global, applies to all commands) |

## Examples

### Example 1: Check Project Status

When user says "check project status" or "what are the issues":

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze
```

Auto-fix detected issues:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze --fix
```

### Example 2: Create Task

When user says "create a new task" or "add task":

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task create
```

### Example 3: Execute Task

When user says "start working on task" or "execute task":

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task execute TASK-001
```

### Example 4: Git Workflow

When user says "switch to task branch":

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js branch checkout <task-id>
```

## Task Priority

| Priority | ID | Description |
|----------|-----|-------------|
| Low | `low` | Optional task |
| Medium | `medium` | Regular task (default) |
| High | `high` | Important task |
| Urgent | `urgent` | Urgent task |

## Task Status

| Status | Description |
|--------|-------------|
| `open` | New task |
| `in_progress` | In progress |
| `blocked` | Blocked |
| `resolved` | Completed |
| `reopened` | Reopened |
| `abandoned` | Abandoned |

## Data Storage

All data is stored in the user project's `.projmnt4claude/` directory:

```
user-project/
└── .projmnt4claude/
    ├── config.json          # Project configuration
    ├── tasks/               # Tasks directory
    │   └── TASK-001/
    │       ├── meta.json    # Task metadata
    │       └── checkpoint.md # Checkpoint
    ├── archive/             # Archived tasks
    ├── toolbox/             # Local skills
    ├── hooks/               # Hook scripts
    └── reports/             # Analysis reports
```

## Command Invocation

In Claude Code, invoke the CLI using:

```bash
# ${CLAUDE_PLUGIN_ROOT} is an environment variable for plugin installation directory
# Or use absolute path

node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js <command> [options]
```

## Important Notes

1. **Initialization**: Run `setup` in the user project before using any command
2. **Git Integration**: Branch commands require running in a Git repository
3. **Dependency Management**: Circular dependencies are automatically detected
4. **Task Archiving**: Deleted tasks are moved to `archive/` directory and can be restored

## More Help

View command help:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js --help
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js <command> --help
```
