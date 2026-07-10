/**
 * Harness 公共工具模块
 *
 * 提取公共代码，避免重复
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// process.ppid 是 Node.js 内置属性（9.3+），无需单独导入
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';
import { getProjectDir } from './path.js';
import { t } from '../i18n/index.js';
import { spawnWithMemoryLimit } from './spawn-utils.js';
import {
  activeChildProcesses,
  killAllActiveChildren,
} from './child-process-registry.js';
export { activeChildProcesses, killAllActiveChildren };
import {
  listOrphanedSessions,
  cleanupOrphanedSessions,
  ensureCleanSessionSlot,
} from './session-lock-cleanup.js';
import {
  buildSessionCliArgs,
  deriveSessionStateFromLegacyFlags,
  type SessionState,
} from './session-id-mapper.js';

// ============================================================
// CA-006: 嵌套执行检测诊断日志
// ============================================================

/** 全局 spawn 计数器（SOL-006-2） */
let globalSpawnCount = 0;

/** 获取当前 spawn 统计信息（SOL-006-2） */
export function getSpawnStatistics(): { totalSpawnCount: number; timestamp: string } {
  return {
    totalSpawnCount: globalSpawnCount,
    timestamp: new Date().toISOString(),
  };
}

/** 创建诊断日志记录器 */
function createDiagnosticsLogger() {
  return {
    warn: (message: string, meta: Record<string, unknown>): void => {
      // eslint-disable-next-line no-console
      console.warn(`[WARN] ${message}: ${JSON.stringify(meta)}`);
    },
    error: (message: string, meta: Record<string, unknown>): void => {
      // eslint-disable-next-line no-console
      console.error(`[ERROR] ${message}: ${JSON.stringify(meta)}`);
    },
    info: (message: string, meta: Record<string, unknown>): void => {
      // eslint-disable-next-line no-console
      console.info(`[INFO] ${message}: ${JSON.stringify(meta)}`);
    },
  };
}

// ============================================================
// 常量定义
// ============================================================

/** 默认超时时间（秒） */
export const DEFAULT_TIMEOUT_SECONDS = 300;

/** 审核阶段超时比例（使用总超时的 1/3） */
export const REVIEW_TIMEOUT_RATIO = 3;

// SOL-001: 提示词文件传递阈值（字节）
// 当提示词超过此阈值时，自动切换为临时文件传递模式
const PROMPT_FILE_THRESHOLD_BYTES = 4096;

// ============================================================
// 类型定义
// ============================================================

export interface HeadlessClaudeOptions {
  prompt: string;
  allowedTools: string[];
  timeout: number;
  cwd: string;
  /** 跳过权限确认（对应 --dangerously-skip-permissions） */
  dangerouslySkipPermissions?: boolean;
  /** 输出格式（对应 --output-format: text/json/stream-json） */
  outputFormat?: string;
  /** 指定 Claude Code CLI session ID，用于跨调用保持上下文连续性 */
  sessionId?: string;
  /**
   * Session 二态（V2.1 §6.1.4.2）：fresh | active
   * 优先使用此字段；未设置时由 deriveSessionStateFromLegacyFlags 从遗留标志推导。
   */
  sessionState?: SessionState;
  /** @deprecated V2.1：改用 sessionState='active'。恢复已有 session（对应 --resume），需配合 sessionId 使用 */
  resumeSession?: boolean;
  /** @deprecated V2.1：forkSession 不再使用。改用 sessionState 字段控制会话行为。 */
  forkSession?: boolean;
  /** 最小模式：跳过 hooks, LSP, plugin sync, auto-memory 等（对应 --bare） */
  bare?: boolean;
  /** 禁用会话持久化（对应 --no-session-persistence） */
  noSessionPersistence?: boolean;
  /** MCP 配置文件路径（对应 --mcp-config） */
  mcpConfig?: string[];
  /** 仅使用指定 MCP 配置（对应 --strict-mcp-config） */
  strictMcpConfig?: boolean;
  /** 插件目录（对应 --plugin-dir） */
  pluginDir?: string[];
  /** 插件 URL（对应 --plugin-url） */
  pluginUrl?: string[];
  /** 禁用 skills（对应 --disable-slash-commands） */
  disableSlashCommands?: boolean;
  /** 努力程度（对应 --effort） */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** API 预算上限（对应 --max-budget-usd） */
  maxBudgetUsd?: number;
  /** 调试模式（对应 --debug） */
  debug?: boolean;
}

export interface HeadlessClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  hookWarning?: string;
  /** 原始 stderr 输出 */
  stderr?: string;
  /** 子进程 PID（用于外部追踪与清理） */
  childPid?: number;
}

/**
 * 退出钩子注册状态（CP-03，INV-20260619-002 Track B）
 *
 * 防止重复注册：installExitHooks() 多次调用只生效一次，
 * uninstallExitHooks() 在流水线正常结束或测试场景下移除监听。
 */
interface InstalledExitHooks {
  handler: (signal: NodeJS.Signals) => void;
  exitHandler: (code: number) => void;
  signals: NodeJS.Signals[];
}

let installedHooks: InstalledExitHooks | null = null;

/**
 * 安装进程退出钩子（CP-03）
 *
 * 在 SIGTERM/SIGINT/SIGHUP/exit 触发时：
 *   1. 先 SIGTERM 已注册子进程，给 Claude CLI 机会自行清理 session-env
 *   2. 同步扫描并清理所有孤儿 session-env 锁目录（崩溃残留兜底）
 *
 * 使用场景：
 *   - harness.ts pipeline 入口处调用一次
 *   - 测试或正常退出路径调用 uninstallExitHooks() 解除
 *
 * @param knownCliUuids - 当前已知活跃的 cliUuid 集合，清理时跳过（可选）
 * @param sessionEnvRoot - session-env 根目录覆盖（测试用）
 */
export function installExitHooks(
  knownCliUuids: Set<string> = new Set(),
  sessionEnvRoot?: string,
): void {
  if (installedHooks) {
    return;
  }

  const handler = (_signal: NodeJS.Signals): void => {
    try {
      killAllActiveChildren('SIGTERM');
      // SIGHUP/SIGTERM 多见于外部强制终止：尽力清理 session-env 孤儿
      const orphans = listOrphanedSessions(knownCliUuids, sessionEnvRoot);
      if (orphans.length > 0) {
        cleanupOrphanedSessions(orphans);
      }
    } catch {
      // 钩子内绝不能抛出，避免覆盖原始信号语义
    }
    // 不在此处 process.exit，让既有 gracefulShutdown 流程接管
  };

  const exitHandler = (_code: number): void => {
    try {
      // 进程即将退出：SIGKILL 兜底，防止僵尸
      killAllActiveChildren('SIGKILL');
      // 清理所有已知 UUID 的锁目录（进程退出时无需保留）
      for (const uuid of knownCliUuids) {
        ensureCleanSessionSlot(uuid, sessionEnvRoot);
      }
      // 清理孤儿锁（不在已知集合中的残留）
      const orphans = listOrphanedSessions(knownCliUuids, sessionEnvRoot);
      if (orphans.length > 0) {
        cleanupOrphanedSessions(orphans);
      }
    } catch {
      // noop
    }
  };

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  for (const sig of signals) {
    process.on(sig, handler);
  }
  process.on('exit', exitHandler);

  installedHooks = { handler, exitHandler, signals };
}

/**
 * 卸载 installExitHooks 注册的监听器（CP-03）
 *
 * 用于测试隔离与 pipeline 正常结束后的资源回收。
 */
export function uninstallExitHooks(): void {
  if (!installedHooks) {
    return;
  }
  for (const sig of installedHooks.signals) {
    process.removeListener(sig, installedHooks.handler);
  }
  process.removeListener('exit', installedHooks.exitHandler);
  installedHooks = null;
}

/**
 * 分析 Headless Claude 的 exit code 和 stderr，区分 hook 失败和任务失败。
 *
 * Hook 失败（如 SessionEnd hook cancelled）不应阻断流水线：
 * - hook 失败 + stdout 有有效输出 → 视为成功，附带警告
 * - hook 失败 + stdout 为空 → 保守判定为失败
 * - 非 hook 错误 → 真实的任务失败
 */
export function classifyExitResult(
  code: number | null,
  stderr: string,
  stdout: string,
  cwd?: string
): { success: boolean; error?: string; hookWarning?: string } {
  // 获取 i18n 文本，失败时使用默认中文
  let texts: ReturnType<typeof t>;
  try {
    texts = t(cwd || process.cwd());
  } catch {
    texts = t();
  }

  if (code === 0) {
    return { success: true };
  }

  const isHookError = /hook\s+.*\s+failed/i.test(stderr)
    || /Hook cancelled/i.test(stderr)
    || /SessionEnd\s+hook/i.test(stderr);
  const hasOutput = stdout.trim().length > 0;

  if (isHookError && hasOutput) {
    return {
      success: true,
      hookWarning: `${texts.harness.logs.hookWarningIgnored}: ${stderr.substring(0, 200)}`,
    };
  }

  if (isHookError && !hasOutput) {
    return {
      success: false,
      error: `${texts.harness.logs.hookErrorNoOutput}: ${stderr.substring(0, 200)}`,
    };
  }

  return {
    success: false,
    error: stderr || `${texts.harness.logs.processExitCode}: ${code}`,
  };
}

export interface ParseVerdictOptions {
  resultField: string;
  reasonField: string;
  listField: string;
  checkpointField: string;
  detailsField?: string;
}

export interface ParsedVerdict {
  passed: boolean;
  reason: string;
  items: string[];
  failedCheckpoints: string[];
  details?: string;
}

// ============================================================
// 公共函数
// ============================================================

export async function runHeadlessClaude(options: HeadlessClaudeOptions): Promise<HeadlessClaudeResult> {
  // CA-006 SOL-006-1 + SOL-006-2: 嵌套执行诊断日志
  const logger = createDiagnosticsLogger();
  globalSpawnCount++;
  const currentSpawnId = globalSpawnCount;
  const startTimeMs = Date.now();

  // 记录执行上下文（诊断，不中断）
  // SOL-002: 引入 parentPpid（操作系统层面的父进程 PID）用于诊断
  // - 与 expectedParentPid（环境变量中记录的"期望父进程"）配合，可交叉验证嵌套场景
  // - 顺序重试场景：expectedParentPid=0（finally 已清除），不触发检测
  // - 真嵌套场景：expectedParentPid>0 且 process.pid 与之不同，触发 ERROR
  const contextInfo = {
    spawnId: currentSpawnId,
    isInHeadlessMode: !!process.env.CLAUDE_CLI_MODE,
    spawnDepth: (parseInt(process.env.CLAUDE_SPAWN_DEPTH || '0') + 1),
    parentPid: process.pid,
    parentPpid: process.ppid,
    expectedParentPid: parseInt(process.env.CLAUDE_SPAWN_PARENT_PID || '0'),
    cwd: options.cwd,
    timeout: options.timeout,
    timestamp: new Date().toISOString(),
  };

  logger.info('spawn_start', contextInfo);

  // SOL-002: 改进嵌套检测，区分真正嵌套 vs 顺序重试
  // 使用 contextInfo 中预计算的 expectedParentPid（已避免重复读取环境变量）
  if (process.env.CLAUDE_CLI_MODE === 'headless') {
    const isTrueNesting = contextInfo.expectedParentPid > 0 && process.pid !== contextInfo.expectedParentPid;

    if (isTrueNesting) {
      // 真正的嵌套：当前进程 PID 与设置环境变量时的进程 PID 不同
      logger.error('POTENTIAL_NESTED_EXECUTION', {
        message: '检测到真正的嵌套 spawn（子进程内部再 spawn 子进程）',
        spawnId: currentSpawnId,
        spawnDepth: contextInfo.spawnDepth,
        parentPid: contextInfo.parentPid,
        parentPpid: contextInfo.parentPpid,
        expectedParentPid: contextInfo.expectedParentPid,
        recommendation: '检查调用链，避免在 headless 上下文中再次 spawn',
      });
    } else {
      // 顺序重试：同一进程内再次 spawn（非嵌套）
      logger.warn('SAME_PROCESS_RE_SPAWN', {
        message: '同一进程内再次 spawn headless Claude（非嵌套，可能是重试）',
        spawnId: currentSpawnId,
        spawnDepth: contextInfo.spawnDepth,
        parentPpid: contextInfo.parentPpid,
        expectedParentPid: contextInfo.expectedParentPid,
        recommendation: '检查是否遗漏了环境变量清除（SOL-001）',
      });
    }
    // 注意：不抛出异常，继续执行
    // 原因：抛出异常可能触发上层重试，反而增加 spawn 次数
  }

  // SOL-001: 保存原始环境变量，用于 finally 恢复
  const originalCliMode = process.env.CLAUDE_CLI_MODE;
  const originalSpawnDepth = process.env.CLAUDE_SPAWN_DEPTH;

  // SOL-001: 临时文件路径和清理状态（在外层 try 块之前声明，确保 finally 块可访问）
  let tempFile: string | undefined;
  let tempFileCleaned = false;

  try {
    // 设置环境标记（子进程继承）
    process.env.CLAUDE_CLI_MODE = 'headless';
    process.env.CLAUDE_SPAWN_DEPTH = String(contextInfo.spawnDepth);
    // CLAUDE_SPAWN_PARENT_PID 是纯临时标记（transient marker），不在 finally 中保存/恢复，
    // 而是无条件 delete。与 CLAUDE_CLI_MODE / CLAUDE_SPAWN_DEPTH 的 save-restore 模式不同，
    // 因为此变量仅在当前函数作用域内有效，不反映外部预设状态。
    process.env.CLAUDE_SPAWN_PARENT_PID = String(process.pid);

    // 注意：prompt 通过 stdin 传递，而不是命令行参数
    // 这样可以避免多行文本作为命令行参数时的解析问题
    const args = [
      '--allowedTools', options.allowedTools.join(','),
      '--print',
    ];

    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.outputFormat) {
      args.push('--output-format', options.outputFormat);
    }

    // Session 连续性支持（V2.1 §6.1.4.2 三态分支）
    // 旧实现 resumeSession + sessionId 自动补 --fork-session 的隐式行为，
    // 已收敛到 deriveSessionStateFromLegacyFlags → buildSessionCliArgs。
    if (options.sessionId) {
      const state = deriveSessionStateFromLegacyFlags({
        sessionState: options.sessionState,
        resumeSession: options.resumeSession,
        forkSession: options.forkSession,
      });
      args.push(...buildSessionCliArgs(state, options.sessionId));
    }

    // 新增: 资源控制相关参数
    if (options.bare) {
      args.push('--bare');
    }
    if (options.noSessionPersistence) {
      args.push('--no-session-persistence');
    }
    if (options.mcpConfig && options.mcpConfig.length > 0) {
      for (const config of options.mcpConfig) {
        args.push('--mcp-config', config);
      }
    }
    if (options.strictMcpConfig) {
      args.push('--strict-mcp-config');
    }
    if (options.pluginDir && options.pluginDir.length > 0) {
      for (const dir of options.pluginDir) {
        args.push('--plugin-dir', dir);
      }
    }
    if (options.pluginUrl && options.pluginUrl.length > 0) {
      for (const url of options.pluginUrl) {
        args.push('--plugin-url', url);
      }
    }
    if (options.disableSlashCommands) {
      args.push('--disable-slash-commands');
    }
    if (options.effort) {
      args.push('--effort', options.effort);
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd));
    }
    if (options.debug) {
      args.push('--debug');
    }

    // SOL-001: 基于阈值选择传递模式
    const promptBytes = Buffer.byteLength(options.prompt, 'utf8');
    const useFileMode = promptBytes > PROMPT_FILE_THRESHOLD_BYTES;

    logger.info('prompt_mode_decision', {
      promptBytes,
      threshold: PROMPT_FILE_THRESHOLD_BYTES,
      useFileMode,
      promptChars: options.prompt.length,
    });

    // spawn + promise 部分用内层 try-catch 捕获 spawn 级同步错误并 resolve 为失败结果
    // 验证错误（如 deriveSessionStateFromLegacyFlags/buildSessionCliArgs 抛出）不在此 catch 范围内，
    // 会向上传播为 rejection，保持 V2.1 forked 拒绝语义
    try {
      // 省略 env 选项：子进程直接继承当前 process.env（含已设置的 headless 标记），
      // 与旧版显式 `env: { ...process.env }` 快照式拷贝功能等价（spawn 同步执行，中间无 env 修改）
      const child = spawnWithMemoryLimit('claude', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],  // stdin 改为 pipe 以支持写入
        timeout: options.timeout * 1000,
      }, 'claudeAgent');

      // PID 已由 spawnWithMemoryLimit 自动注册到 child-process-registry（CP-01/CP-02/CP-03）

      // SOL-001: 根据阈值选择传递模式
      if (useFileMode) {
        // 临时文件模式：解决复杂提示词输出不稳定问题
        tempFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}-${process.pid}.txt`);
        try {
          fs.writeFileSync(tempFile, options.prompt, 'utf8');

          logger.info('temp_file_created', {
            tempFile,
            fileSize: fs.statSync(tempFile).size,
            promptBytes,
            promptChars: options.prompt.length,
          });

          const readStream = fs.createReadStream(tempFile, 'utf8');
          readStream.pipe(child.stdin!);

          logger.info('file_stream_started', { tempFile, promptBytes });
        } catch (fileError) {
          // 文件创建失败，回退到 stdin 模式
          const failedTempFile = tempFile;
          tempFile = undefined;
          logger.error('temp_file_create_failed', {
            tempFile: failedTempFile,
            error: fileError instanceof Error ? fileError.message : String(fileError),
          });
          writePromptViaStdin(child, options.prompt);
        }
      } else {
        // stdin 模式：通过 stdin 分块写入
        writePromptViaStdin(child, options.prompt);
      }

      return await new Promise<HeadlessClaudeResult>((resolve) => {
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        // PID 反注册由 spawnWithMemoryLimit 内部 exit/close/error 事件自动处理（CP-03）

        child.on('close', (code: number | null) => {
          const classified = classifyExitResult(code, stderr, stdout);
          const durationMs = Date.now() - startTimeMs;

          // SOL-001: 文件模式完成日志
          if (useFileMode && tempFile) {
            logger.info('file_stream_completed', {
              tempFile,
              durationMs,
              outputLength: stdout.length,
            });
          }

          logger.info('spawn_end', {
            spawnId: currentSpawnId,
            success: classified.success,
            code,
            durationMs,
            totalSpawnCount: globalSpawnCount,
          });

          // SOL-001: 清理临时文件
          if (tempFile) {
            try {
              fs.unlinkSync(tempFile);
              tempFileCleaned = true;
              logger.info('temp_file_cleaned', { tempFile });
            } catch (cleanupError) {
              logger.error('temp_file_cleanup_failed', {
                tempFile,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              });
            }
          }

          resolve({
            success: classified.success,
            output: stdout,
            error: classified.error,
            hookWarning: classified.hookWarning,
            stderr,
            childPid: child.pid,
          });
        });

        child.on('error', (error: Error) => {
          logger.error('spawn_error', {
            spawnId: currentSpawnId,
            error: error.message,
            totalSpawnCount: globalSpawnCount,
          });

          // SOL-001: 错误时也清理临时文件
          if (tempFile) {
            try {
              fs.unlinkSync(tempFile);
              tempFileCleaned = true;
              logger.info('temp_file_cleaned', { tempFile });
            } catch (cleanupError) {
              logger.error('temp_file_cleanup_failed', {
                tempFile,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              });
            }
          }

          resolve({
            success: false,
            output: '',
            error: error.message,
            stderr: '',
            childPid: child.pid,
          });
        });
      });
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        stderr: '',
      };
    }
  } finally {
    // SOL-001: 恢复原始环境变量
    if (originalCliMode === undefined) {
      delete process.env.CLAUDE_CLI_MODE;
    } else {
      process.env.CLAUDE_CLI_MODE = originalCliMode;
    }

    if (originalSpawnDepth === undefined) {
      delete process.env.CLAUDE_SPAWN_DEPTH;
    } else {
      process.env.CLAUDE_SPAWN_DEPTH = originalSpawnDepth;
    }

    delete process.env.CLAUDE_SPAWN_PARENT_PID;

    // SOL-001: 兜底清理临时文件（处理超时等异常场景）
    if (tempFile && !tempFileCleaned) {
      try {
        fs.unlinkSync(tempFile);
        logger.info('temp_file_cleaned', { tempFile, source: 'finally_fallback' });
      } catch (cleanupError) {
        logger.error('temp_file_cleanup_failed', {
          tempFile,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          source: 'finally_fallback',
        });
      }
    }
  }
}

/**
 * 通过 stdin 分块写入 prompt（SOL-001 提取的公共方法）
 */
function writePromptViaStdin(child: ReturnType<typeof spawnWithMemoryLimit>, prompt: string): void {
  if (!child.stdin) return;

  const chunkSize = 4096;
  let offset = 0;

  const writeNextChunk = (): void => {
    if (offset >= prompt.length) {
      child.stdin!.end();
      return;
    }

    const chunk = prompt.substring(offset, offset + chunkSize);
    offset += chunkSize;

    const result = child.stdin!.write(chunk);
    if (!result) {
      child.stdin!.once('drain', writeNextChunk);
    } else {
      writeNextChunk();
    }
  };

  writeNextChunk();
}

/**
 * 延迟函数（秒）
 */
export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * 归档已存在的报告文件
 *
 * 在重试场景中，报告文件可能已存在。此函数将旧报告复制到 archive/ 子目录，
 * 保留历史记录用于事后根因分析。
 *
 * 归档路径格式: {报告目录}/archive/{ISO-timestamp}-{原始文件名}
 */
export function archiveReportIfExists(reportPath: string, cwd?: string): void {
  // 测试注入点
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testMock = (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__?.archiveReportIfExists;
  if (testMock) {
    return testMock(reportPath, cwd);
  }

  // 防御性编程：确保 texts 始终有值，防止 "texts is not defined" 错误
  let texts: ReturnType<typeof t>;
  try {
    texts = t(cwd);
  } catch {
    const { getI18n } = require('../i18n/index.js');
    texts = getI18n('zh');
  }
  try {
    // Resolve to absolute path to ensure correct behavior with relative paths
    const absolutePath = path.resolve(reportPath);

    if (!fs.existsSync(absolutePath)) {
      return;
    }

    const dir = path.dirname(absolutePath);
    const filename = path.basename(absolutePath);
    const archiveDir = path.join(dir, 'archive');

    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(archiveDir, `${timestamp}-${filename}`);

    fs.copyFileSync(absolutePath, archivePath);
    console.log(`   📦 ${texts.harness.logs.archivedReport.replace('{filename}', `${timestamp}-${filename}`)}`);
  } catch (error) {
    // 归档失败不阻断报告写入流程
    console.warn(`   ⚠️ ${texts.harness.logs.archiveFailed}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function saveReport(reportPath: string, content: string): Promise<void> {
  const dir = path.dirname(reportPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    archiveReportIfExists(reportPath);
    fs.writeFileSync(reportPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`保存报告失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function filterCheckpoints(
  task: TaskMeta,
  filterFn: (checkpoint: CheckpointMetadata) => boolean
): CheckpointMetadata[] {
  if (!task.checkpoints) {
    return [];
  }
  return task.checkpoints.filter(filterFn);
}

// ============================================================
// 结构化结果匹配
// ============================================================

export interface StructuredResult {
  passed: boolean | null;
  /** 匹配级别: 1=EVALUATION_RESULT行, 2=Markdown标题, 3=关键词, null=无匹配 */
  matchLevel: 1 | 2 | 3 | null;
}

/**
 * 按三级优先级匹配结构化评估结果
 *
 * Level 1: EVALUATION_RESULT: PASS/NOPASS 行（强制格式）
 * Level 2: Markdown 标题格式（向后兼容: ## 评估结果: PASS 等）
 * Level 3: PASS/NOPASS 关键词（首次出现）
 *
 * 替代中文情感判断，避免技术文档中高频词导致假 PASS
 */
export function parseStructuredResult(output: string): StructuredResult {
  if (!output || output.trim().length === 0) {
    return { passed: null, matchLevel: null };
  }

  // Level 1: 结构化标记行（强制格式）
  // 匹配 EVALUATION_RESULT: PASS/NOPASS 和 VERDICT: PASS/NOPASS
  const level1 = output.match(/(?:EVALUATION_RESULT|VERDICT)\s*[:：]\s*(PASS|NOPASS)/i);
  if (level1) {
    return { passed: level1[1]!.toUpperCase() === 'PASS', matchLevel: 1 };
  }

  // Level 2: Markdown 标题格式（向后兼容）
  const level2Patterns = [
    /##\s*(?:评估结果|审核结果|验证结果|Evaluation Result|Result|Verdict)\s*[:：]?\s*(PASS|NOPASS)/i,
    /(?:评估结果|审核结果|验证结果|Evaluation Result|Result|Verdict)[:：]?\s*(PASS|NOPASS)/i,
    /"result"\s*[:：]\s*"(PASS|NOPASS)"/i,
  ];
  for (const pattern of level2Patterns) {
    const match = output.match(pattern);
    if (match) {
      return { passed: match[1]!.toUpperCase() === 'PASS', matchLevel: 2 };
    }
  }

  // Level 3: PASS/NOPASS 关键词（首次出现）
  const level3 = output.match(/\b(PASS|NOPASS)\b/i);
  if (level3) {
    return { passed: level3[1]!.toUpperCase() === 'PASS', matchLevel: 3 };
  }

  return { passed: null, matchLevel: null };
}

export function parseVerdictResult(
  output: string,
  options: ParseVerdictOptions
): ParsedVerdict {
  const result: ParsedVerdict = {
    passed: true,
    reason: '',
    items: [],
    failedCheckpoints: [],
    details: '',
  };

  const resultPattern = new RegExp(`##\\s*${options.resultField}\\s*[:：]\\s*(PASS|NOPASS)`, 'i');
  const resultMatch = output.match(resultPattern);
  if (resultMatch) {
    result.passed = resultMatch[1]!.toUpperCase() === 'PASS';
  }

  const reasonPattern = new RegExp(`##\\s*${options.reasonField}\\s*[:：]?\\s*(.+?)(?=\\n##[^#]|$)`, 'si');
  const reasonMatch = output.match(reasonPattern);
  if (reasonMatch) {
    result.reason = reasonMatch[1]!.trim();
  }

  const listPattern = new RegExp(`##\\s*${options.listField}\\s*[:：]?\\s*(.+?)(?=\\n##[^#]|$)`, 'si');
  const listMatch = output.match(listPattern);
  if (listMatch) {
    const listText = listMatch[1]!.trim();
    if (listText && listText !== '无' && listText !== 'N/A' && listText !== '#') {
      result.items = listText.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0 && line !== '#');
    }
  }

  const checkpointPattern = new RegExp(`##\\s*${options.checkpointField}\\s*[:：]?\\s*(.+?)(?=\\n##[^#]|$)`, 'si');
  const checkpointMatch = output.match(checkpointPattern);
  if (checkpointMatch) {
    const checkpointText = checkpointMatch[1]!.trim();
    if (checkpointText && checkpointText !== '无' && checkpointText !== 'N/A' && checkpointText !== '#') {
      result.failedCheckpoints = checkpointText.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0 && line !== '#');
    }
  }

  if (options.detailsField) {
    const detailsPattern = new RegExp(`##\\s*${options.detailsField}\\s*[:：]?\\s*(.+?)(?=\\n##[^#]|$)`, 'si');
    const detailsMatch = output.match(detailsPattern);
    if (detailsMatch) {
      result.details = detailsMatch[1]!.trim();
    }
  }

  // 结构化格式未匹配时，使用三级优先级关键词匹配（替代中文情感判断）
  if (!resultMatch) {
    const structured = parseStructuredResult(output);
    if (structured.passed !== null) {
      result.passed = structured.passed;
      if (!result.reason) {
        // 尝试从 REASON/EVALUATION_REASON/原因 字段提取原因
        const reasonPatterns = [
          /REASON\s*[:：]\s*(.+?)(?=\n\n|\n## |$)/si,
          /EVALUATION_REASON\s*[:：]\s*(.+?)(?=\n\n|\n## |$)/si,
          new RegExp(`##?\s*${options.reasonField}\s*[:：]?\s*(.+?)(?=\n\n|\n## |$)`, 'si'),
        ];
        for (const pattern of reasonPatterns) {
          const match = output.match(pattern);
          if (match && match[1]?.trim()) {
            result.reason = match[1].trim();
            break;
          }
        }
        // 如果仍然找不到原因，使用默认消息
        if (!result.reason) {
          result.reason = `基于结构化关键词匹配（级别 ${structured.matchLevel}）`;
        }
      }
    }
  }

  if (!result.reason) {
    result.reason = '无法解析判定结果';
  }

  return result;
}

export function getReportDir(taskId: string, cwd: string): string {
  return path.join(getProjectDir(cwd), 'reports', 'harness', taskId);
}

export function getReportPath(taskId: string, reportType: string, cwd: string): string {
  return path.join(getReportDir(taskId, cwd), `${reportType}-report.md`);
}

// ============================================================
// 报告文件解析（用于 pipeline 恢复时重建前置数据）
// ============================================================

/** parseDevReport 返回的解析结果 */
export interface ParsedDevReport {
  taskId: string;
  status: string;
  duration: number;
  evidence: string[];
  checkpointsCompleted: string[];
  startTime: string;
  endTime: string;
  error?: string;
}

/** parseCodeReviewReport / parseQAReport 返回的解析结果 */
export interface ParsedVerdictReport {
  taskId: string;
  result: 'PASS' | 'NOPASS';
  reason: string;
  failedCheckpoints: string[];
  details?: string;
}

/** rebuildPrerequisiteData 返回的重建数据 */
export interface PrerequisiteData {
  devReport: ParsedDevReport | null;
  codeReviewVerdict: ParsedVerdictReport | null;
  qaVerdict: ParsedVerdictReport | null;
}

/**
 * 从报告文件中提取列表项（支持 "无" / "N/A" / "(无)" 等空值标记）
 */
function extractListItems(text: string | undefined): string[] {
  if (!text) return [];
  const trimmed = text.trim();
  if (!trimmed || /^(无|N\/A|\(无\)|\s*- \(无\)\s*)$/i.test(trimmed)) return [];
  return trimmed.split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line.length > 0 && line !== '(无)');
}

/**
 * CP-1: 从 dev-report.md 提取状态(status)、耗时(duration)、证据文件(evidence)
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseDevReport(filePath: string): ParsedDevReport | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;

    // 提取 taskId（标题行）
    const titleMatch = content.match(/^#\s*开发报告\s*[-–—]\s*(.+?)\s*$/m);
    const taskId = titleMatch?.[1]?.trim() || '';

    // 提取状态
    const statusMatch = content.match(/\*\*状态\*\*\s*[:：]\s*(.+?)\s*$/m);
    const status = statusMatch?.[1]?.trim() || 'unknown';

    // 提取耗时
    const durationMatch = content.match(/\*\*耗时\*\*\s*[:：]\s*([\d.]+)\s*s/m);
    const duration = durationMatch ? parseFloat(durationMatch[1]!) * 1000 : 0;

    // 提取时间
    const startTimeMatch = content.match(/\*\*开始时间\*\*\s*[:：]\s*(.+?)\s*$/m);
    const endTimeMatch = content.match(/\*\*结束时间\*\*\s*[:：]\s*(.+?)\s*$/m);

    // 提取证据文件
    const evidenceMatch = content.match(/##\s*证据文件\s*[:：]?\s*\n([\s\S]*?)(?=\n##|\n```|$)/i);
    const evidence = extractListItems(evidenceMatch?.[1]);

    // 提取完成的检查点
    const checkpointsMatch = content.match(/##\s*完成的检查点\s*[:：]?\s*\n([\s\S]*?)(?=\n##|\n```|$)/i);
    const checkpointsCompleted = extractListItems(checkpointsMatch?.[1]);

    // 提取错误信息
    const errorMatch = content.match(/##\s*错误信息\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
    const error = errorMatch?.[1]?.trim() || undefined;

    return {
      taskId,
      status,
      duration,
      evidence,
      checkpointsCompleted,
      startTime: startTimeMatch?.[1]?.trim() || '',
      endTime: endTimeMatch?.[1]?.trim() || '',
      error,
    };
  } catch {
    return null;
  }
}

/**
 * CP-2: 从 code-review-report.md 提取 PASS/NOPASS 结果和原因
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseCodeReviewReport(filePath: string): ParsedVerdictReport | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;

    return parseVerdictReportContent(content, 'code_review');
  } catch {
    return null;
  }
}

/**
 * CP-3: 从 qa-report.md 提取 PASS/NOPASS 结果和原因
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseQAReport(filePath: string): ParsedVerdictReport | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;

    return parseVerdictReportContent(content, 'qa');
  } catch {
    return null;
  }
}

/**
 * 共用的审核报告内容解析逻辑
 */
function parseVerdictReportContent(content: string, _source: 'code_review' | 'qa'): ParsedVerdictReport | null {
  // 提取 taskId（标题行）
  const titleMatch = content.match(/^#\s*(?:代码审核|QA\s*验证)\s*报告\s*[-–—]\s*(.+?)\s*$/m);
  const taskId = titleMatch?.[1]?.trim() || '';

  // 提取结果：**结果**: ✅ PASS / ❌ NOPASS
  const resultMatch = content.match(/\*\*结果\*\*\s*[:：]\s*(?:✅|❌)?\s*(PASS|NOPASS)/i);
  if (!resultMatch) return null;
  const result = resultMatch[1]!.toUpperCase() as 'PASS' | 'NOPASS';

  // 提取原因
  const reasonMatch = content.match(/##\s*原因\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
  const reason = reasonMatch?.[1]?.trim() || '';

  // 提取未通过的检查点
  const failedCpMatch = content.match(/##\s*未通过的检查点\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
  const failedCheckpoints = extractListItems(failedCpMatch?.[1]);

  // 提取详细反馈
  const detailsMatch = content.match(/##\s*详细反馈\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
  const details = detailsMatch?.[1]?.trim() || undefined;

  return {
    taskId,
    result,
    reason,
    failedCheckpoints,
    details,
  };
}

/**
 * CP-4: 根据目标阶段，从报告文件重建前置数据
 *
 * 阶段依赖关系：
 * - development: 无前置（从头开始）
 * - code_review: 需要 dev-report
 * - qa: 需要 dev-report + code-review-report
 * - evaluation: 需要 dev-report + code-review-report + qa-report
 *
 * 解析失败时返回 null，调用方负责降级处理（降级为从 development 重新开始）
 */
export function rebuildPrerequisiteData(
  taskId: string,
  phase: string,
  cwd: string,
): PrerequisiteData | null {
  try {
    const reportDir = getReportDir(taskId, cwd);

    // development 阶段不需要前置数据
    if (phase === 'development') {
      return { devReport: null, codeReviewVerdict: null, qaVerdict: null };
    }

    // 始终需要 dev-report（除 development 外的所有阶段）
    const devReport = parseDevReport(path.join(reportDir, 'dev-report.md'));
    if (!devReport) return null;

    // code_review 阶段只需要 dev-report
    if (phase === 'code_review') {
      return { devReport, codeReviewVerdict: null, qaVerdict: null };
    }

    // qa / qa_verification 阶段还需要 code-review-report
    if (phase === 'qa' || phase === 'qa_verification') {
      const codeReviewVerdict = parseCodeReviewReport(path.join(reportDir, 'code-review-report.md'));
      if (!codeReviewVerdict) return null;
      return { devReport, codeReviewVerdict, qaVerdict: null };
    }

    // evaluation 阶段还需要 code-review-report + qa-report
    if (phase === 'evaluation') {
      const codeReviewVerdict = parseCodeReviewReport(path.join(reportDir, 'code-review-report.md'));
      if (!codeReviewVerdict) return null;
      const qaVerdict = parseQAReport(path.join(reportDir, 'qa-report.md'));
      if (!qaVerdict) return null;
      return { devReport, codeReviewVerdict, qaVerdict };
    }

    // 未知阶段，返回 null 触发降级
    return null;
  } catch {
    return null;
  }
}
