/**
 * Safe Command Executor
 *
 * Provides secure command execution for checkpoint verification.
 * Uses blacklist-first strategy to block dangerous operations.
 *
 * @module utils/safe-command-executor
 */

import { spawnWithMemoryLimit } from './spawn-utils.js';

// ============================================================
// Types
// ============================================================

/**
 * Command execution result
 */
export interface CommandResult {
  /** Whether execution succeeded (exitCode === 0) */
  success: boolean;
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution duration (ms) */
  duration: number;
  /** Whether execution timed out */
  timedOut: boolean;
  /** Error message (if any) */
  error?: string;
}

/**
 * Command execution options
 */
export interface ExecuteOptions {
  /** Working directory (required) */
  cwd: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Command validation result
 */
export interface ValidationResult {
  /** Whether command is valid */
  valid: boolean;
  /** Reason if invalid */
  reason?: string;
}

// ============================================================
// Constants
// ============================================================

/**
 * Forbidden command prefixes (system dangerous commands)
 */
const FORBIDDEN_PREFIXES: string[] = [
  // System management
  'sudo', 'su', 'passwd', 'useradd', 'userdel', 'usermod',
  'groupadd', 'groupdel', 'groupmod',
  'systemctl', 'service', 'journalctl',
  // Network
  'iptables', 'ip6tables', 'ufw', 'firewall-cmd',
  'ssh', 'scp', 'rsync', 'sftp',
  // Disk
  'mount', 'umount', 'fdisk', 'parted',
  'mkfs', 'fsck', 'dd',
  // Power
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  // Scheduled tasks
  'crontab', 'at', 'batch',
];

/**
 * Forbidden patterns (dangerous operations)
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf/, reason: 'Recursive deletion is forbidden' },
  { pattern: />\s*\//, reason: 'Overwriting system files is forbidden' },
  { pattern: /\|\s*sh/, reason: 'Piping to shell is forbidden' },
  { pattern: /\|\s*bash/, reason: 'Piping to bash is forbidden' },
  { pattern: /\$\([^)]+\)/, reason: 'Command substitution is forbidden' },
  { pattern: /`[^`]+`/, reason: 'Backtick command substitution is forbidden' },
  { pattern: /curl.*\|.*sh/, reason: 'Remote script execution is forbidden' },
  { pattern: /wget.*\|.*sh/, reason: 'Remote script execution is forbidden' },
  { pattern: /eval\s+/, reason: 'eval is forbidden' },
  { pattern: /exec\s+/, reason: 'exec is forbidden' },
  { pattern: /sudo\s+/, reason: 'sudo is forbidden' },
  { pattern: /chmod\s+[0-7]{3,4}/, reason: 'Permission modification is forbidden' },
  { pattern: /chown\s+/, reason: 'Owner modification is forbidden' },
  { pattern: /mkfs/, reason: 'Filesystem formatting is forbidden' },
  { pattern: /dd\s+if=/, reason: 'Disk operations are forbidden' },
  { pattern: />\s*\/dev/, reason: 'Writing to device files is forbidden' },
  { pattern: /kill\s+-9/, reason: 'Force killing processes is forbidden' },
  { pattern: /shutdown/, reason: 'Shutdown is forbidden' },
  { pattern: /reboot/, reason: 'Reboot is forbidden' },
  { pattern: /init\s+[06]/, reason: 'Runlevel change is forbidden' },
];

/**
 * Maximum command length
 */
const MAX_COMMAND_LENGTH = 500;

/**
 * Maximum number of arguments
 */
const MAX_ARGS = 50;

/**
 * Default timeout (60 seconds)
 */
const DEFAULT_TIMEOUT = 60000;

// ============================================================
// Validation
// ============================================================

/**
 * Parse command string into command and arguments
 *
 * Handles:
 * - Quoted arguments (single and double quotes)
 * - Escaped characters
 * - Environment variable assignments (VAR=value)
 *
 * @param command - Command string to parse
 * @returns Parsed command parts
 */
function parseCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let escaped = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      i++;
      continue;
    }

    if (char === '\\' && inQuote !== "'") {
      // Backslash escapes next character (except in single quotes)
      escaped = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === null) {
        // Start quote
        inQuote = char;
      } else if (inQuote === char) {
        // End quote
        inQuote = null;
      } else {
        // Different quote type inside quote - keep as literal
        current += char;
      }
      i++;
      continue;
    }

    if (char === ' ' && inQuote === null) {
      // Space outside quotes - split here
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      i++;
      continue;
    }

    current += char;
    i++;
  }

  // Add last part
  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

/**
 * Validate command format
 *
 * Uses blacklist-first strategy: only block dangerous operations,
 * allow all other legitimate commands.
 *
 * @param command - Command to validate
 * @returns Validation result
 */
export function validateCommand(command: string): ValidationResult {
  // 1. Check command length
  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      valid: false,
      reason: `Command length exceeds limit (${MAX_COMMAND_LENGTH} characters)`,
    };
  }

  // 2. Parse command
  const parts = parseCommand(command);
  if (parts.length > MAX_ARGS) {
    return {
      valid: false,
      reason: `Command has too many arguments (${parts.length} > ${MAX_ARGS})`,
    };
  }

  // 3. Check forbidden prefixes
  const firstPart = parts[0]?.toLowerCase();
  if (firstPart && FORBIDDEN_PREFIXES.includes(firstPart)) {
    return {
      valid: false,
      reason: `Forbidden system command: ${firstPart}`,
    };
  }

  // 4. Check forbidden patterns
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason,
      };
    }
  }

  return { valid: true };
}

// ============================================================
// Executor
// ============================================================

/**
 * Safe Command Executor
 *
 * Executes commands securely with:
 * - Blacklist validation
 * - Timeout protection
 * - Working directory restriction
 * - spawn() to avoid shell injection
 */
export class SafeCommandExecutor {
  /**
   * Execute a command
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Execution result
   */
  async execute(command: string, options: ExecuteOptions): Promise<CommandResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    // 1. Validate command
    const validation = validateCommand(command);
    if (!validation.valid) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        timedOut: false,
        error: `Command validation failed: ${validation.reason}`,
      };
    }

    // 2. Parse command
    const parts = parseCommand(command);
    const [cmd, ...args] = parts;

    if (!cmd) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        timedOut: false,
        error: 'Empty command',
      };
    }

    // 3. Execute command using spawn (avoid shell injection)
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawnWithMemoryLimit(cmd, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        timeout,
        shell: false,
      }, 'default');

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({
          success: exitCode === 0 && !timedOut,
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          timedOut,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          timedOut: false,
          error: error.message,
        });
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);

      // Clean up timeout on close
      proc.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }

  /**
   * Execute multiple commands in sequence
   *
   * Stops on first failure
   *
   * @param commands - Commands to execute
   * @param options - Execution options
   * @returns Array of results
   */
  async executeAll(
    commands: string[],
    options: ExecuteOptions
  ): Promise<CommandResult[]> {
    const results: CommandResult[] = [];

    for (const command of commands) {
      const result = await this.execute(command, options);
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        break;
      }
    }

    return results;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a safe command executor instance
 */
export function createSafeCommandExecutor(): SafeCommandExecutor {
  return new SafeCommandExecutor();
}

export default SafeCommandExecutor;
