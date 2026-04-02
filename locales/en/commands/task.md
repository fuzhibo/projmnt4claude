# Task Command - Manage Project Tasks

Create, view, update, and execute tasks.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js task <action> [options]
```

## AI Behavior Guidelines

### Direct Output Mode (No AI Processing)
When the user **only** invokes the command without additional prompts, **output the script result directly**:

```
User: projmnt4claude task list
AI: [Output command result directly]

User: projmnt4claude task show TASK-001
AI: [Output command result directly]
```

### AI Processing Mode
When the user invokes the command **followed by additional prompts**, AI processes:

```
User: projmnt4claude task list, find the highest priority task
AI: [Analyze results, find P0 task]

User: projmnt4claude task show TASK-001, what still needs to be done?
AI: [Analyze checkpoints, answer uncompleted items]
```

### AI Internal Calls (Compact Mode)
AI calls should use `--json` or `--compact` to reduce context:

```bash
projmnt4claude task show TASK-001 --json
projmnt4claude task list --json --fields id,title,status
```

## Available Actions

| Action | Description | Example |
|--------|-------------|---------|
| `create` | Create new task interactively | `task create` |
| `list` | List all tasks | `task list --status in_progress` |
| `show` | Display task details | `task show TASK-001` |
| `update` | Update task properties | `task update TASK-001 --status resolved` |
| `delete` | Delete (archive) task | `task delete TASK-001` |
| `rename` | Rename task ID | `task rename TASK-001 TASK-feature-new-name` |
| `purge` | Purge abandoned tasks | `task purge -y` |
| `execute` | Guide task execution | `task execute TASK-001` |
| `checkpoint` | Complete checkpoint | `task checkpoint TASK-001` |
| `dependency` | Manage dependencies | `task dependency add TASK-001 --dep-id TASK-002` |
| `add-subtask` | Create subtask for parent task | `task add-subtask TASK-001 "Implement login"` |
| `split` | Split task into subtasks | `task split TASK-001 --into 3` |
| `search` | Search tasks | `task search "login"` |
| `batch-update` | Batch update tasks | `task batch-update --status in_progress` |
| `submit` | Submit task for verification | `task submit TASK-001` |
| `validate` | Validate submitted task | `task validate TASK-001` |
| `history` | View task change history | `task history TASK-001` |
| `status-guide` | Show status transition guide | `task status-guide` |
| `complete` | One-click complete task | `task complete TASK-001` |
| `count` | Count tasks | `task count -g status` |
| `sync-children` | Sync child task status | `task sync-children TASK-001` |
| `discuss` | Mark task for discussion | `task discuss TASK-001 --topic "Option choice"` |
| `help` | Show help | `task help` |

## Filter Options (list)
- `--status <status>` - Filter by status
- `--priority <priority>` - Filter by priority
- `--role <role>` - Filter by recommended role
- `--fields <fields>` - Custom output fields (comma-separated) **[AI Recommended]**
- `--json` - JSON output **[AI Recommended]**
- `--missing-verification` - Filter tasks missing verification
- `-g, --group <field>` - Group display: status/priority/type/role

## Display Options (show)
- `-v, --verbose` - Show full info (history, dependencies, verification)
- `--history` - Show change history only
- `--json` - JSON output **[AI Recommended]**
- `--compact` - Compact output (no decorations) **[AI Recommended]**
- `--checkpoints` - Show checkpoint details (with verification results)

## Update Options (update)
- `--title <title>` - Update title
- `--description <desc>` - Update description
- `--status <status>` - Update status
- `--priority <priority>` - Update priority
- `--role <role>` - Update recommended role
- `--branch <branch>` - Update associated branch
- `--token <token>` - Checkpoint verification token (for resolved status)
- `--sync-children` - Sync child task status (when completing parent)
- `--no-sync` - Don't sync child task status

## rename - Rename Task

Rename task ID. Automatically updates references in other tasks (dependencies, parent-child relationships).

```bash
projmnt4claude task rename <oldTaskId> <newTaskId>
```

**Example:**
```bash
projmnt4claude task rename TASK-001 TASK-feature-new-name
```

## purge - Purge Abandoned Tasks

Physically delete tasks with `abandoned` status from the archive directory (irreversible).

```bash
projmnt4claude task purge [-y]
```

**Options:**
- `-y, --yes` - Non-interactive mode, execute deletion directly
- `--json` - JSON output

**Example:**
```bash
projmnt4claude task purge -y
```

## split - Split Task

Split a task into multiple subtasks. Supports splitting by count or custom titles. Creates chained dependencies automatically.

```bash
projmnt4claude task split <taskId> [--into <count>] [--titles <titles>] [-y]
```

**Options:**
- `--into <count>` - Number of subtasks (auto-generates titles)
- `--titles <titles>` - Subtask title list (comma-separated)
- `-y, --yes` - Non-interactive mode

**Example:**
```bash
projmnt4claude task split TASK-001 --into 3
projmnt4claude task split TASK-001 --titles "Frontend,Backend API,Tests"
```

## search - Search Tasks

Search tasks by keyword, matching ID, title, and description.

```bash
projmnt4claude task search <keyword> [--status <status>] [--priority <priority>] [--json]
```

**Options:**
- `--status <status>` - Filter by status
- `--priority <priority>` - Filter by priority
- `--json` - JSON output

**Example:**
```bash
projmnt4claude task search "login"
projmnt4claude task search "API" --status open --json
```

## batch-update - Batch Update Tasks

Batch update status or priority of multiple tasks.

```bash
projmnt4claude task batch-update --status <status> [--priority <priority>] [--all] [-y]
```

**Options:**
- `--status <status>` - New status (required if no --priority)
- `--priority <priority>` - New priority (required if no --status)
- `--all` - Include completed/closed tasks
- `-y, --yes` - Non-interactive mode

**Example:**
```bash
projmnt4claude task batch-update --status in_progress -y
```

## submit - Submit Task for Verification

Change task status from `in_progress`/`open` to `wait_complete`, awaiting quality gate verification.

```bash
projmnt4claude task submit <taskId> [--note <note>]
```

**Options:**
- `--note <note>` - Submission note

**Example:**
```bash
projmnt4claude task submit TASK-001
projmnt4claude task submit TASK-001 --note "All checkpoints completed"
```

## validate - Validate Task

Validate a `wait_complete` task. On success, auto-updates to `resolved`; on failure, returns to `in_progress`.

```bash
projmnt4claude task validate <taskId>
```

**Example:**
```bash
projmnt4claude task validate TASK-001
```

## history - View Change History

View the complete change history of a task, including status transitions, field changes, and reasons.

```bash
projmnt4claude task history <taskId>
```

**Example:**
```bash
projmnt4claude task history TASK-001
```

## status-guide - Status Transition Guide

Display task status descriptions and transition matrix.

```bash
projmnt4claude task status-guide
```

## complete - One-Click Complete Task

Automatically: verify checkpoints → update status to `resolved`. Uncompleted checkpoints prompt for auto-completion.

```bash
projmnt4claude task complete <taskId> [-y]
```

**Options:**
- `-y, --yes` - Non-interactive mode, auto-mark checkpoints and complete

**Example:**
```bash
projmnt4claude task complete TASK-001
projmnt4claude task complete TASK-001 -y
```

## count - Count Tasks

Count tasks with optional grouping by status, priority, type, or role.

```bash
projmnt4claude task count [--status <status>] [--priority <priority>] [--type <type>] [-g <field>] [--json]
```

**Options:**
- `--status <status>` - Filter by status
- `--priority <priority>` - Filter by priority
- `--type <type>` - Filter by type (bug/feature/research/docs/refactor/test)
- `-g, --group <field>` - Group by: status/priority/type/role
- `--json` - JSON output

**Example:**
```bash
projmnt4claude task count
projmnt4claude task count -g status
projmnt4claude task count --json
```

## sync-children - Sync Child Task Status

Sync parent task status to all child tasks. Closed/abandoned children are skipped.

```bash
projmnt4claude task sync-children <parentTaskId> [--status <status>]
```

**Options:**
- `--status <status>` - Target status (defaults to parent's current status)

**Example:**
```bash
projmnt4claude task sync-children TASK-001
projmnt4claude task sync-children TASK-001 --status resolved
```

## discuss - Mark Task for Discussion

Mark task as needing discussion. This feature is integrated into the `update` command via `--needs-discussion`.

```bash
projmnt4claude task discuss <taskId> --topic <topic>
```

> **Tip**: Use `task update TASK-001 --needs-discussion` to mark, and `--topic "Topic"` to add a discussion topic.

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
