# Config Command - Manage Configuration

Manage project configuration in `.projmnt4claude/config.json`.

## Usage

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js config <action> [key] [value]
```

## Actions

### list - List All Configuration

List all configuration items and their values for the current project.

```bash
projmnt4claude config list
```

### get - Get Configuration Value

Get the value of a specific configuration item.

```bash
projmnt4claude config get <key>
```

**Parameters:**
- `key` (required) - Configuration item name

### set - Set Configuration Value

Set the value of a specific configuration item.

```bash
projmnt4claude config set <key> <value>
```

**Parameters:**
- `key` (required) - Configuration item name
- `value` (required) - Configuration item value

## Supported Actions

| Action | Description | Required Parameters |
|--------|-------------|---------------------|
| `list` | List all configuration items | None |
| `get` | Get value of a specific config item | `key` |
| `set` | Set value of a specific config item | `key`, `value` |

## Examples

### List all configurations
```bash
projmnt4claude config list
```

### Get a specific configuration
```bash
projmnt4claude config get language
```

### Set a configuration value
```bash
projmnt4claude config set language en
```

## Notes

1. Requires `setup` to have been run first to initialize the project environment
2. Configuration is stored in `.projmnt4claude/config.json`
3. The `set` action modifies the configuration file directly
