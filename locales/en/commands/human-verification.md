# Human Verification Command - Manage Verification Checkpoints

Manage checkpoints that require human verification, with support for listing, approving, rejecting, and batch processing.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification <action> [taskId] [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--checkpoint <id>` | Specify checkpoint ID (approve/reject only) |
| `--reason <reason>` | Rejection reason (reject only) |
| `--feedback <feedback>` | Verification feedback (approve/batch only) |
| `--approve-all` | Approve all pending verifications (batch only) |
| `--status <status>` | Filter by status: pending/approved/rejected (list only) |
| `--json` | JSON format output (list/report only) |

## Actions

### list - List Verification Checkpoints

List checkpoints pending human verification, with optional status filtering.

```bash
projmnt4claude human-verification list
```

Filter by status:

```bash
projmnt4claude human-verification list --status pending
```

List checkpoints for a specific task:

```bash
projmnt4claude human-verification list <taskId>
```

JSON format output:

```bash
projmnt4claude human-verification list --json
```

**Parameters:**
- `taskId` (optional) - Task ID to filter checkpoints
- `--status <status>` (optional) - Filter status: pending/approved/rejected
- `--json` (optional) - Output in JSON format

### approve - Approve Checkpoint

Approve a verification checkpoint for a specific task.

```bash
projmnt4claude human-verification approve <taskId>
```

Approve a specific checkpoint with feedback:

```bash
projmnt4claude human-verification approve <taskId> --checkpoint <id> --feedback "Confirmed"
```

**Parameters:**
- `taskId` (required) - Task ID
- `--checkpoint <id>` (optional) - Specific checkpoint ID
- `--feedback <text>` (optional) - Verification feedback

### reject - Reject Checkpoint

Reject a verification checkpoint for a specific task.

```bash
projmnt4claude human-verification reject <taskId>
```

Reject a specific checkpoint with a reason:

```bash
projmnt4claude human-verification reject <taskId> --checkpoint <id> --reason "Code quality below standard"
```

**Parameters:**
- `taskId` (required) - Task ID
- `--checkpoint <id>` (optional) - Specific checkpoint ID
- `--reason <text>` (optional) - Rejection reason

### batch - Batch Process Verifications

Batch process all pending verification checkpoints.

```bash
projmnt4claude human-verification batch --approve-all
```

Batch approve with feedback:

```bash
projmnt4claude human-verification batch --approve-all --feedback "Batch confirmed"
```

**Parameters:**
- `--approve-all` (optional) - Approve all pending checkpoints
- `--feedback <text>` (optional) - Batch processing feedback

### report - View Verification Report

Generate and display an overall human verification report.

```bash
projmnt4claude human-verification report
```

JSON format output:

```bash
projmnt4claude human-verification report --json
```

**Parameters:**
- `--json` (optional) - Output in JSON format

## Supported Actions

| Action | Description | Required Parameters |
|--------|-------------|---------------------|
| `list` | List verification checkpoints | None |
| `approve` | Approve a checkpoint | `taskId` |
| `reject` | Reject a checkpoint | `taskId` |
| `batch` | Batch process verifications | None |
| `report` | View verification report | None |

## Examples

### Review and approve a task checkpoint
```bash
projmnt4claude human-verification list --status pending
projmnt4claude human-verification approve TASK-001 --checkpoint cp-1 --feedback "Looks good"
```

### Reject with a reason
```bash
projmnt4claude human-verification reject TASK-002 --reason "Needs refactoring"
```

### Batch approve all pending
```bash
projmnt4claude human-verification batch --approve-all
```

## Notes

1. Requires `setup` to have been run first to initialize the project environment
2. `approve` and `reject` require a task ID
3. Provide a rejection reason when using `reject` for better traceability
4. `batch --approve-all` approves all pending items — use with caution
5. Verification statuses: pending, approved, rejected
