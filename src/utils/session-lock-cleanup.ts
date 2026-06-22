import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 孤儿 session-env 锁目录描述
 */
export interface OrphanedSession {
  /** CLI 层 UUID（目录名） */
  cliUuid: string;
  /** 锁目录绝对路径 */
  lockDir: string;
  /** 最后修改时间（ISO 字符串），用于判断陈旧度 */
  mtime: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 获取 Claude CLI session-env 根目录
 *
 * 支持通过环境变量 `PROJMNT4CLAUDE_SESSION_ENV_ROOT` 覆盖（用于测试隔离）。
 */
export function getSessionEnvRoot(): string {
  const override = process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.claude', 'session-env');
}

/**
 * 判断字符串是否符合 UUID v4 格式
 */
export function isUuidLike(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * 清理 session-env 锁目录（CP-02）
 *
 * V2 修正（INV-20260619-002 / Track B）：
 * 在 `sessionIdMapper.generate()` 之后、Claude CLI 调用之前，
 * 主动清理可能残留的同名锁目录，清理流水线残留锁目录，防止 session-env 无限增长。
 *
 * 残留场景：
 *   - 上一次同 UUID 会话崩溃未清理
 *   - 进程被 SIGKILL 终止，退出钩子未执行
 *   - FCE 重试复用 UUID 时前一轮残留
 *
 * @param cliUuid - CLI 层 UUID
 * @param root - 可选，session-env 根目录（测试用）
 * @returns `true` 表示清理了残留；`false` 表示无残留或清理失败
 */
export function ensureCleanSessionSlot(
  cliUuid: string,
  root?: string,
): boolean {
  if (!isUuidLike(cliUuid)) {
    return false;
  }
  const base = root ?? getSessionEnvRoot();
  const lockDir = path.join(base, cliUuid);
  try {
    if (!fs.existsSync(lockDir)) {
      return false;
    }
    const stat = fs.statSync(lockDir);
    if (!stat.isDirectory()) {
      // 异常：存在同名文件而非目录，保守起见不删除
      return false;
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描 session-env 根目录，列出未在 knownCliUuids 中的孤儿锁（CP-04）
 *
 * @param knownCliUuids - 当前 mapper / 活跃调用方已知的 cliUuid 集合
 * @param root - 可选，session-env 根目录（测试用）
 */
export function listOrphanedSessions(
  knownCliUuids: Set<string>,
  root?: string,
): OrphanedSession[] {
  const base = root ?? getSessionEnvRoot();
  if (!fs.existsSync(base)) {
    return [];
  }

  const orphans: OrphanedSession[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(base);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!isUuidLike(entry)) {
      continue;
    }
    const lockDir = path.join(base, entry);
    try {
      const stat = fs.statSync(lockDir);
      if (!stat.isDirectory()) {
        continue;
      }
      if (knownCliUuids.has(entry)) {
        continue;
      }
      orphans.push({
        cliUuid: entry,
        lockDir,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      // 单个 entry 异常不影响整体扫描
    }
  }
  return orphans;
}

/**
 * 批量清理孤儿锁目录
 *
 * @param orphans - listOrphanedSessions() 返回的列表
 * @returns 成功清理的数量
 */
export function cleanupOrphanedSessions(orphans: OrphanedSession[]): number {
  let cleaned = 0;
  for (const orphan of orphans) {
    try {
      fs.rmSync(orphan.lockDir, { recursive: true, force: true });
      cleaned++;
    } catch {
      // 单个失败不影响其他清理
    }
  }
  return cleaned;
}
