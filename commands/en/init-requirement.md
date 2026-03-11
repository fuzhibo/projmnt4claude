# Init-Requirement Command - Natural Language Task Creation

Create tasks from natural language requirements.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "<description>"
```

## Description

Parses natural language descriptions and creates structured tasks automatically.

## Features

- **Requirement Parsing** - Extracts tasks from natural language
- **Priority Detection** - Identifies task priority from context
- **Dependency Analysis** - Detects task dependencies
- **Role Recommendation** - Suggests appropriate agent roles

## Examples

### Simple Requirement
```bash
projmnt4claude init-requirement "Implement user login functionality"
```

### Complex Requirement
```bash
projmnt4claude init-requirement "Build a complete user authentication system including login, registration, password reset, and email verification"
```

### With Priority Context
```bash
projmnt4claude init-requirement "Urgent: Fix the production database connection issue"
```

## Output

The command will:
1. Parse the requirement
2. Create parent task if needed
3. Create subtasks for components
4. Set up dependencies
5. Recommend execution order

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/init-requirement.md
