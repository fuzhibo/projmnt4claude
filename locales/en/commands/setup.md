# Setup Command - Initialize Project Environment

Initialize project management environment in current project.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js setup
```

## Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Non-interactive mode: skip all confirmations, use default settings |
| `-l, --language <zh\|en>` | Specify language (Chinese/English) |
| `-f, --force` | Force re-initialization (re-copy skill files) |

## Description

The setup command initializes the project management environment:

1. **Language Selection** - Prompts to select interface language (Chinese/English)
2. **Directory Creation** - Creates `.projmnt4claude/` directory structure
3. **Configuration** - Creates default `config.json`
4. **Hook Templates** - Creates hook script templates
5. **Skill Files** - Copies skill and command docs based on selected language

## Directory Structure

```
project/
└── .projmnt4claude/
    ├── config.json          # Project configuration (includes language)
    ├── tasks/               # Task storage
    ├── archive/             # Archived tasks
    ├── toolbox/             # Local skills
    │   └── projmnt4claude/
    │       ├── SKILL.md      # Skill definition
    │       └── commands/     # Command docs
    ├── hooks/               # Hook scripts
    │   ├── pre-task.ts
    │   ├── post-task.ts
    │   └── plan-complete.ts
    ├── bin/                # Executable scripts
    └── reports/             # Analysis reports
```

## Language Support

The setup command supports:
- **中文** - Default
- **English**

All skill files and command docs will be copied in the selected language.

## AI Usage

When AI needs to auto-initialize a project, use non-interactive mode:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js setup -y
```

Or specify language:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js setup -y --language en
```

## Examples

### Basic Setup
```bash
projmnt4claude setup
```

### Non-interactive Setup (for AI)
```bash
projmnt4claude setup -y
```

### Re-initialization
```bash
# If already initialized
projmnt4claude setup
# Output: Project management environment already exists, skipping initialization.
```
