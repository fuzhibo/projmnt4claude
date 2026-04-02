# Branch Command - Git Branch Integration

Manage task-to-Git branch integration with support for branch creation, checkout, merge, and more.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch <action> [id] [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-b, --branch-name <branchName>` | Branch name (create only) |
| `-m, --message <message>` | Merge commit message (merge only) |

## Actions

### checkout - Switch to Task Branch

Switch to the Git branch associated with a specific task.

```bash
projmnt4claude branch checkout <id>
```

**Parameters:**
- `id` (required) - Task ID

### status - View Branch Status

Display current branch and task association status.

```bash
projmnt4claude branch status
```

### create - Create Task Branch

Create a Git branch associated with a specific task.

```bash
projmnt4claude branch create <id>
```

With a custom branch name:

```bash
projmnt4claude branch create <id> --branch-name feature/my-branch
```

**Parameters:**
- `id` (required) - Task ID
- `--branch-name <name>` (optional) - Custom branch name

### delete - Delete Task Branch

Delete the Git branch associated with a specific task.

```bash
projmnt4claude branch delete <id>
```

**Parameters:**
- `id` (required) - Task ID

### merge - Merge Task Branch

Merge the task's branch into the current branch.

```bash
projmnt4claude branch merge <id>
```

With a merge message:

```bash
projmnt4claude branch merge <id> --message "Merge task completion"
```

**Parameters:**
- `id` (required) - Task ID
- `--message <msg>` (optional) - Merge commit message

### push - Push Task Branch

Push the task's branch to the remote repository.

```bash
projmnt4claude branch push <id>
```

**Parameters:**
- `id` (required) - Task ID

### sync - Sync Branches

Sync branch information to keep local and remote branch states consistent.

```bash
projmnt4claude branch sync [id]
```

**Parameters:**
- `id` (optional) - Task ID (syncs all branches if not specified)

## Supported Actions

| Action | Description | Required Parameters |
|--------|-------------|---------------------|
| `checkout` | Switch to task branch | `id` |
| `status` | View branch status | None |
| `create` | Create task branch | `id` |
| `delete` | Delete task branch | `id` |
| `merge` | Merge task branch | `id` |
| `push` | Push task branch to remote | `id` |
| `sync` | Sync branch information | None |

## Examples

### Create and push a task branch
```bash
projmnt4claude branch create TASK-001 --branch-name feature/new-api
projmnt4claude branch push TASK-001
```

### Merge completed task
```bash
projmnt4claude branch merge TASK-001 --message "Complete API feature"
```

### Check branch status
```bash
projmnt4claude branch status
```

## Notes

1. Requires `setup` to have been run first to initialize the project environment
2. The project must be a Git repository
3. Provide a semantic branch name when using `create`
4. Commit all changes before using `merge`
5. `delete` is irreversible — use with caution
