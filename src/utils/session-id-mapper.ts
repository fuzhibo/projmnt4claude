import { randomUUID } from 'crypto';

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
 * Session ID 映射器
 *
 * 实现内部可读 ID 与 CLI UUID 的双向映射。
 * 内部层使用可读格式（dev-TASK-xxx-timestamp-uuidFragment），
 * CLI 层使用标准 UUID v4 格式（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）。
 */
export class SessionIdMapper {
  private mappings = new Map<string, SessionMapping>();

  /**
   * 生成 CLI UUID，同时保留内部可读 ID
   *
   * @param internalId - 内部可读 ID（如 dev-TASK-xxx-1781...-6b44...）
   * @param taskId - 关联任务 ID
   * @param phase - 阶段名称
   * @returns 标准 UUID v4 字符串，用于 Claude Code CLI --session-id
   */
  generate(internalId: string, taskId: string, phase: string): string {
    const cliUuid = randomUUID();
    const mapping: SessionMapping = {
      internalId,
      cliUuid,
      taskId,
      phase,
      createdAt: new Date().toISOString(),
    };
    this.mappings.set(internalId, mapping);
    this.mappings.set(cliUuid, mapping); // 双向查找
    return cliUuid;
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
