# Help Command - Display Help Information

Display help information for commands and features.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js help [topic]
```

## Modes

### 1. No Arguments - General Help
```bash
projmnt4claude help
```
Displays:
- Overview of all available commands
- Brief descriptions
- Quick navigation tips

### 2. Command Name - Detailed Help
```bash
projmnt4claude help task
projmnt4claude help plan
projmnt4claude help status
```
Displays:
- Detailed command description
- All usage examples
- Parameter and option explanations
- Related command links

### 3. Smart Q&A
```bash
projmnt4claude help "how to create task"
projmnt4claude help "task dependencies"
projmnt4claude help "project status"
```
Features:
- Fuzzy matching - supports partial command names
- Auto-completion - Tab key completes command names
- Linked help - related commands reference each other

## Examples

### View All Commands
When user says "what commands are available":
```bash
projmnt4claude help
```

### Learn Specific Command
When user says "how to use task command":
```bash
projmnt4claude help task
```

### Quick Answer
When user asks "how to add task to plan":
```bash
projmnt4claude help "plan add"
```

## File

/home/fuzhibo/workerplace/git/projmnt4claude/commands/help.md
