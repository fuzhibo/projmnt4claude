import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Session 状态三态模型（V2.1 §6.1.7.1）
 *
 * - fresh: 首次启动，不携带任何 session 续接参数，CLI 创建全新会话
 * - active: 同一 runId 内重试，携带 --resume 续接既有会话完整历史
 * - forked: 跨 runId 重启或显式压缩，携带 --resume + --fork-session 分叉会话
 *
 * 状态由 probeSessionState() 探测既有映射 + 运行上下文决定，
 * buildClaudeArgs() 根据状态构造 CLI 参数分支。
 */
export type SessionState = 'fresh' | 'active' | 'forked';

/**
 * Session ID 映射关系
 * 用于在内部可读 ID 和 CLI UUID 之间建立双向映射
 *
 * V2.1 扩展（§6.1.7.5）：新增 runId / status / lastUsedAt / forkCount
 * 支持三态模型探测与跨 runId 续接。
 */
export interface SessionMapping {
  /** 内部可读 ID，如 dev-TASK-xxx-1781...-6b44... */
  internalId: string;
  /** CLI 层标准 UUID，如 6b446e27-8ead-4c31-9e6c-9f3d2a1b8c5f */
  cliUuid: string;
  /** 关联任务 ID */
  taskId: string;
  /** 阶段名称：development | codeReview | qaVerification | evaluation | feedback | assembly-line */
  phase: string;
  /** 创建时间 */
  createdAt: string;
  /**
   * 流水线运行标识（V2.1）：
   * 同一次 harness 启动（含 --continue 恢复）共享同一 runId，
   * 跨 runId 触发 forked 状态。空值表示 V2 之前的历史映射。
   */
  runId?: string;
  /**
   * Session 当前状态（V2.1）：fresh | active | forked
   * 由 probeSessionState 维护，反映最后一次使用时的状态。
   */
  status?: SessionState;
  /**
   * 最后使用时间（V2.1）：每次 generate/探测命中时刷新，
   * 用于 preflight 脚本清理陈旧映射。
   */
  lastUsedAt?: string;
  /**
   * 累计 fork 次数（V2.1）：每次跨 runId 续接（forked）时递增，
   * 用于诊断压缩频率与检测异常重启循环。
   */
  forkCount?: number;
}

/**
 * probeSessionState() 返回的探测结果（§6.1.7.3）
 */
export interface SessionProbeResult {
  /** 探测得出的最终状态 */
  state: SessionState;
  /** 对应的 CLI UUID（首次启动时由确定性派生生成） */
  cliUuid: string;
  /** 命中的既有映射；fresh 状态下为 undefined */
  mapping?: SessionMapping;
  /** 当前 runId（resolveRunId 输出） */
  runId: string;
  /** 决策原因（审计/诊断用） */
  reason: string;
}

/**
 * 审计日志条目：记录 generate() 调用
 */
export interface SessionMappingAuditEntry {
  mapping: SessionMapping;
  isReused: boolean;
}

/**
 * Session ID 映射器
 *
 * 实现内部可读 ID 与 CLI UUID 的双向映射。
 * 内部层使用可读格式（dev-TASK-xxx-timestamp-uuidFragment），
 * CLI 层使用标准 UUID v4 格式（xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx）。
 *
 * V2 修正（INV-20260619-002 / CP-01）：
 * CLI UUID 从 (internalId, taskId, phase) 经 SHA256 派生，保证确定性。
 * 相同输入始终产生相同 UUID，消除 retry 重试时的 UUID 漂移。
 */
export class SessionIdMapper {
  private mappings = new Map<string, SessionMapping>();
  private auditLogger?: (entry: SessionMappingAuditEntry) => void;

  /**
   * 设置审计日志回调（CP-05）
   * 每次 generate() 调用时触发，用于记录 session 映射创建/复用事件
   */
  setAuditLogger(logger: (entry: SessionMappingAuditEntry) => void): void {
    this.auditLogger = logger;
  }

  /**
   * 生成 CLI UUID，同时保留内部可读 ID
   *
   * V2 修正：使用 SHA256(internalId|taskId|phase) 派生 UUID v4，
   * 相同输入产生相同 UUID（幂等性），消除 randomUUID 导致的冲突。
   *
   * @param internalId - 内部可读 ID（如 dev-TASK-xxx-1781...-6b44...）
   * @param taskId - 关联任务 ID
   * @param phase - 阶段名称
   * @returns 标准 UUID v4 字符串，用于 Claude Code CLI --session-id
   */
  generate(
    internalId: string,
    taskId: string,
    phase: string,
    options?: {
      runId?: string;
      state?: SessionState;
    },
  ): string {
    const cliUuid = this.deriveDeterministicUuid(internalId, taskId, phase);
    const now = new Date().toISOString();
    const runId = options?.runId;
    const state = options?.state;

    const existing = this.mappings.get(internalId);
    const isReused = existing?.cliUuid === cliUuid;

    if (existing && !isReused) {
      // 同一 internalId 切换到不同 (taskId, phase)：清理旧 cliUuid 映射避免泄漏
      this.mappings.delete(existing.cliUuid);
    }

    if (!isReused) {
      const mapping: SessionMapping = {
        internalId,
        cliUuid,
        taskId,
        phase,
        createdAt: now,
        ...(runId ? { runId } : {}),
        ...(state ? { status: state } : {}),
        lastUsedAt: now,
        forkCount: state === 'forked' ? 1 : 0,
      };
      this.mappings.set(internalId, mapping);
      this.mappings.set(cliUuid, mapping);

      if (this.auditLogger) {
        this.auditLogger({ mapping, isReused: false });
      }
    } else {
      // 幂等复用：刷新状态字段（V2.1 §6.1.7.5）
      const reused = existing!;
      reused.lastUsedAt = now;
      if (state) {
        reused.status = state;
      }
      if (runId) {
        // 跨 runId 复用 → 视为 forked，递增 forkCount
        if (reused.runId && reused.runId !== runId) {
          reused.status = 'forked';
          reused.forkCount = (reused.forkCount ?? 0) + 1;
        }
        reused.runId = runId;
      }
      if (this.auditLogger) {
        this.auditLogger({ mapping: reused, isReused: true });
      }
    }

    return cliUuid;
  }

  /**
   * 从 (internalId, taskId, phase) 经 SHA256 派生确定性 UUID v4
   *
   * UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
   *   - 第 3 段首字符固定为 '4'（version 4）
   *   - 第 4 段首字符为 8/9/a/b（variant 10xx）
   */
  deriveDeterministicUuid(
    internalId: string,
    taskId: string,
    phase: string,
  ): string {
    const hash = createHash('sha256')
      .update(`${internalId}|${taskId}|${phase}`)
      .digest('hex');

    const variantChar = ((parseInt(hash.slice(16, 18), 16) & 0x3) | 0x8).toString(16);

    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16),
      variantChar + hash.slice(17, 20),
      hash.slice(20, 32),
    ].join('-');
  }

  /**
   * 内部 ID → CLI UUID
   */
  toCliUuid(internalId: string): string | undefined {
    return this.mappings.get(internalId)?.cliUuid;
  }

  /**
   * CLI UUID → 内部 ID
   */
  toInternalId(cliUuid: string): string | undefined {
    return this.mappings.get(cliUuid)?.internalId;
  }

  /**
   * 获取完整映射
   */
  getMapping(id: string): SessionMapping | undefined {
    return this.mappings.get(id);
  }

  /**
   * 序列化为 JSON（用于持久化到 meta.json）
   */
  serialize(): SessionMapping[] {
    // 去重：按 cliUuid 去重
    const seen = new Map<string, SessionMapping>();
    for (const mapping of this.mappings.values()) {
      seen.set(mapping.cliUuid, mapping);
    }
    return Array.from(seen.values());
  }

  /**
   * 反序列化（CP-06）：从 serialize() 输出重建映射状态
   *
   * 用于 session 上下文恢复场景：meta.json 中保存的映射可在新进程内重建，
   * 保证 serialize → deserialize 闭环完整性。
   *
   * @param mappings - serialize() 返回的数组
   */
  deserialize(mappings: SessionMapping[]): void {
    for (const mapping of mappings) {
      this.mappings.set(mapping.internalId, mapping);
      this.mappings.set(mapping.cliUuid, mapping);
    }
  }

  /**
   * 清空所有映射
   */
  clear(): void {
    this.mappings.clear();
  }

  /**
   * 获取映射数量
   */
  size(): number {
    // 去重后计算
    const seen = new Set<string>();
    for (const mapping of this.mappings.values()) {
      seen.add(mapping.cliUuid);
    }
    return seen.size;
  }

    /**
     * 探测 session 状态（V2.1 §6.1.7.3）
     *
     * 决策矩阵：
     *  - 无既有映射              → fresh   （CLI 创建新会话）
     *  - 既有映射且 runId 相同   → active  （--resume 续接完整历史）
     *  - 既有映射但 runId 不同   → forked  （--resume + --fork-session 分叉）
     *
     * 注意：探测不修改既有映射状态。状态写入由 generate() 在实际启动时完成。
     * 这样探测可安全用于 dry-run / preflight 检查。
     */
    probeSessionState(
      internalId: string,
      taskId: string,
      phase: string,
      runId: string,
    ): SessionProbeResult {
      const cliUuid = this.deriveDeterministicUuid(internalId, taskId, phase);
      const existing = this.mappings.get(internalId);

      if (!existing || existing.cliUuid !== cliUuid) {
        return {
          state: 'fresh',
          cliUuid,
          runId,
          reason: `no existing mapping for internalId=${internalId}`,
        };
      }

      if (existing.runId && existing.runId === runId) {
        return {
          state: 'active',
          cliUuid,
          mapping: existing,
          runId,
          reason: `same runId=${runId} → resume full history`,
        };
      }

      return {
        state: 'forked',
        cliUuid,
        mapping: existing,
        runId,
        reason: `existing runId=${existing.runId ?? '(unset)'} differs from current runId=${runId} → fork`,
      };
    }

    /**
     * 解析当前 runId（V2.1 §6.1.7.2）
     *
     * 优先级：
     *  1. 显式传入的 runId（调用方测试 / 手动注入）
     *  2. HARNESS_RUN_ID 环境变量（流水线启动时注入）
     *  3. .projmnt4claude/harness-run-id 当前文件内容
     *  4. 回退到 process.pid + timestamp 的确定性派生（避免随机 UUID）
     *
     * --continue 恢复时，调用方应先读取持久化的 harness-status.json 中的 runId，
     * 然后通过 env 或显式参数注入，保证恢复的流水线与原启动使用同一 runId。
     */
    resolveRunId(explicit?: string): string {
      if (explicit && explicit.trim()) {
        return explicit.trim();
      }
      const envRunId = process.env.HARNESS_RUN_ID;
      if (envRunId && envRunId.trim()) {
        return envRunId.trim();
      }
      const projectRoot = process.env.PROJMNT4CLAUDE_ROOT ?? process.cwd();
      const runIdFile = join(projectRoot, '.projmnt4claude', 'harness-run-id');
      if (existsSync(runIdFile)) {
        const fileRunId = readFileSync(runIdFile, 'utf8').trim();
        if (fileRunId) {
          return fileRunId;
        }
      }
      return `run-${process.pid}-${Date.now()}`;
    }

    /**
     * 构造稳定的 internalId（V2.1 §6.1.7.5）
     *
     * 稳定 internalId 形式：`${prefix}-${taskId}-stable-${phase}`
     * 例如：cr-TASK-xxx-stable-development
     *
     * 同一任务同一阶段的多次重试 / 跨 runId 恢复均生成相同 internalId，
     * 从而派生相同 cliUuid，保证 probeSessionState 能命中既有映射。
     */
    buildStableInternalId(taskId: string, phase: string, prefix = 'cr'): string {
      return `${prefix}-${taskId}-stable-${phase}`;
    }
  }

/** 全局单例 */
export const sessionIdMapper = new SessionIdMapper();

// ============================================================
// V2.1 §6.1.4.2 — CLI 参数构造辅助
// ============================================================

/** UUID v4 正则（用于 assertIsValidUuidV4） */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 校验字符串是否为合法 UUID v4（V2.1 §6.1.4.2）
 *
 * Claude CLI 2.1.123+ 在 --session-id 入参处执行严格 UUID 占用检查，
 * 非法 UUID 直接报错 "Session ID already in use" 或 "Invalid session ID"。
 * 所有 sessionState='fresh' 分支派生的 cliUuid 在构造 --session-id 参数前
 * 必须通过此校验。
 */
export function assertIsValidUuidV4(value: string, label = 'sessionId'): void {
  if (!value || typeof value !== 'string') {
    throw new Error(`[${label}] must be a non-empty string, got: ${String(value)}`);
  }
  if (!UUID_V4_PATTERN.test(value)) {
    throw new Error(`[${label}] must be a valid UUID v4, got: ${value}`);
  }
}

/**
 * 从遗留标志推导 sessionState（V2.1 向后兼容 §6.1.4.2）
 *
 * 调用方未显式传入 sessionState 时使用此辅助。
 * 推导规则保留 V2 之前的行为语义：
 *  - resumeSession=true && forkSession=true → 'forked'
 *  - resumeSession=true（无 forkSession）   → 'active'
 *  - 其它                                    → 'fresh'
 *
 * 注意：V2 之后调用方应直接传入 sessionState，此函数仅为兼容旧 API。
 */
export function deriveSessionStateFromLegacyFlags(options: {
  sessionState?: SessionState;
  resumeSession?: boolean;
  forkSession?: boolean;
}): SessionState {
  if (options.sessionState) {
    return options.sessionState;
  }
  if (options.resumeSession && options.forkSession) {
    return 'forked';
  }
  if (options.resumeSession) {
    return 'active';
  }
  return 'fresh';
}

/**
 * 根据 sessionState 构造 CLI session 相关参数（V2.1 §6.1.4.2 三态分支）
 *
 * 分支：
 *  - fresh:  --session-id <uuid>                           （创建新会话）
 *  - active: --session-id <uuid> --resume                  （同 runId 续接）
 *  - forked: --session-id <uuid> --resume --fork-session   （跨 runId 分叉）
 *
 * @returns argv 片段，调用方 push 到完整 args 中
 */
export function buildSessionCliArgs(
  state: SessionState,
  cliUuid: string,
): string[] {
  assertIsValidUuidV4(cliUuid, 'cliUuid');
  switch (state) {
    case 'fresh':
      return ['--session-id', cliUuid];
    case 'active':
      return ['--session-id', cliUuid, '--resume'];
    case 'forked':
      return ['--session-id', cliUuid, '--resume', '--fork-session'];
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unknown sessionState: ${String(_exhaustive)}`);
    }
  }
}
