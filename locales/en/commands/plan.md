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
| `recommend` | Smart task recommendations (3-layer dependency inference) |

## Options

- `-j, --json` - Output as JSON (show/recommend)
- `-f, --force` - Skip confirmation (clear only)
- `-a, --after <taskId>` - Add after specified task (add only)
- `-y, --yes` - Non-interactive, auto-apply recommendations (recommend only)
- `-q, --query <query>` - Filter by user description/keywords (recommend only)
- `--smart` - Enable AI semantic dependency inference Layer3 (recommend only)
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

### Get Recommendations with Filters
```bash
# Filter by keywords
projmnt4claude plan recommend --query "authentication login"

# Include non-open tasks
projmnt4claude plan recommend --all

# AI-friendly JSON output
projmnt4claude plan recommend --json

# Smart mode (Layer3 AI semantic inference)
projmnt4claude plan recommend --smart

# Smart + JSON + auto-apply
projmnt4claude plan recommend --smart --yes --json
```

## Recommendation Algorithm

`plan recommend` uses a 3-layer dependency inference + task chain analysis algorithm:

### Three-Layer Dependency Inference

| Layer | Name | Activation | Method |
|-------|------|------------|--------|
| Layer1/2 | File path overlap | Default | O(n²) file set intersection between task pairs, time-order determines direction |
| Layer3 | AI semantic inference | `--smart` flag | AI analyzes task title/description semantics to infer implicit functional dependencies |

**Layer3 AI Semantic Inference** identifies dependencies that file overlap cannot detect:
- Login feature depends on user model definition
- API endpoints depend on database schema
- Test tasks depend on the implementation being tested
- Config module depends on environment variable definitions

**Zero-overhead guarantee**: Without `--smart`, Layer3 code path is completely skipped with no AI calls.

### Algorithm Flow

1. **Task Collection** - Retrieves all tasks; recommends `open` status by default, `--all` includes non-terminal tasks
2. **Keyword Filtering** - When `--query` is provided, extracts keywords and filters matching tasks
3. **Executability Filter** - Excludes tasks with unmet dependencies
4. **Task Chain Analysis** - Traverses dependency graph via DFS to identify all task chains (no chain count limit)
5. **AI Semantic Inference** - When `--smart` is active, calls AI to analyze semantic dependencies between tasks (Layer3)
6. **Chain Sorting** - Sorted by:
   - Priority ascending (P0 first)
   - Architecture layer ascending (Layer0 base first at same priority)
   - Chain length descending (longer chains first at same layer)
   - Reopen count descending (frequently reopened chains first)
7. **Batch Grouping** - Groups chains by priority level into execution batches; same-priority chains marked as parallelizable

### Key Features

- **Full Recommendation**: All matching tasks are recommended, no quantity limit
- **Unlimited Chains**: All dependency chains analyzed regardless of length or count
- **Batch Parallelism**: Different chains at same priority can execute in parallel
- **Keyword Filtering**: Supports Chinese and English keyword matching (`--query`)
- **Three-Layer Inference**: Layer1/2 file overlap + Layer3 AI semantics (activated by `--smart`)

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/plan.md
