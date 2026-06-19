import { createHash } from 'crypto';

/**
 * Session ID 映射关系
 * 用于在内部可读 ID 和 CLI UUID 之间建立双向映射
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
  generate(internalId: string, taskId: string, phase: string): string {
    const cliUuid = this.deriveDeterministicUuid(internalId, taskId, phase);

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
        createdAt: new Date().toISOString(),
      };
      this.mappings.set(internalId, mapping);
      this.mappings.set(cliUuid, mapping);

      if (this.auditLogger) {
        this.auditLogger({ mapping, isReused: false });
      }
    } else if (this.auditLogger) {
      this.auditLogger({ mapping: existing!, isReused: true });
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
  private deriveDeterministicUuid(
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
}

/** 全局单例 */
export const sessionIdMapper = new SessionIdMapper();
