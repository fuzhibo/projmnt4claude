# Tool Command - Manage Local Skills

Manage local skill toolbox for the project.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js tool <action> [name] [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-j, --json` | Output in JSON format (list action only) |
| `-s, --source <source>` | Source URL (install action only) |

## Actions

### list - List All Skills

List all installed local skills in the project.

```bash
projmnt4claude tool list
```

Output in JSON format:

```bash
projmnt4claude tool list --json
```

### create - Create New Skill

Interactively create a new local skill.

```bash
projmnt4claude tool create
```

### install - Install Skill

Install a skill from a specified source.

```bash
projmnt4claude tool install --source <url>
```

Or install by name:

```bash
projmnt4claude tool install <name>
```

**Parameters:**
- `--source <url>` or `<name>` (required) - Source URL or name of the skill

### remove - Remove Skill

Remove an installed local skill.

```bash
projmnt4claude tool remove <name>
```

**Parameters:**
- `name` (required) - Name of the skill to remove

### deploy - Deploy Skill

Deploy a specified local skill.

```bash
projmnt4claude tool deploy <name>
```

**Parameters:**
- `name` (required) - Name of the skill to deploy

### undeploy - Undeploy Skill

Undeploy a specified local skill.

```bash
projmnt4claude tool undeploy <name>
```

**Parameters:**
- `name` (required) - Name of the skill to undeploy

## Supported Actions

| Action | Description | Required Parameters |
|--------|-------------|---------------------|
| `list` | List all installed skills | None |
| `create` | Interactively create a new skill | None |
| `install` | Install skill from source | `--source <url>` or `<name>` |
| `remove` | Remove an installed skill | `name` |
| `deploy` | Deploy a skill | `name` |
| `undeploy` | Undeploy a skill | `name` |

## Examples

### List skills in JSON format
```bash
projmnt4claude tool list --json
```

### Install from URL
```bash
projmnt4claude tool install --source https://example.com/skill.tar.gz
```

### Deploy a skill
```bash
projmnt4claude tool deploy my-skill
```

## Notes

1. Requires `setup` to have been run first to initialize the project environment
2. Skills are installed in `.projmnt4claude/toolbox/` directory
3. `create` is interactive and guides through skill creation
4. `install` requires a valid source URL or skill name
