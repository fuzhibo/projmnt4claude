import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ensureCleanSessionSlot,
  listOrphanedSessions,
  cleanupOrphanedSessions,
  getSessionEnvRoot,
  isUuidLike,
} from '../session-lock-cleanup.js';

/**
 * CP-7: ensureCleanSessionSlot 清理边界（V2.1 §6.1.6.2）
 *
 * 责任边界契约：
 *   - ✅ 清理 ~/.claude/session-env/<uuid>/ （插件层锁目录）
 *   - ❌ 不清理 ~/.claude/projects/**    （Claude CLI 对话历史）
 *   - ❌ 不清理 ~/.claude/todos/**
 *   - ❌ 不清理 ~/.claude/shell-snapshots/**
 *
 * 测试通过 PROJMNT4CLAUDE_SESSION_ENV_ROOT 环境变量隔离，
 * 完全不触碰真实 ~/.claude 目录。
 */
describe('CP-7: ensureCleanSessionSlot boundary', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cp7-session-env-'),
    );
    process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT = tmpRoot;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略
    }
    delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
  });

  describe('ensureCleanSessionSlot', () => {
    it('清理已存在的 UUID 锁目录', () => {
      const uuid = '12345678-1234-4234-8234-123456789012';
      const lockDir = path.join(tmpRoot, uuid);
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(path.join(lockDir, 'lock.json'), '{}');

      const cleaned = ensureCleanSessionSlot(uuid);
      expect(cleaned).toBe(true);
      expect(fs.existsSync(lockDir)).toBe(false);
    });

    it('UUID 不存在时返回 false（无残留）', () => {
      const uuid = '12345678-1234-4234-8234-123456789012';
      expect(ensureCleanSessionSlot(uuid)).toBe(false);
    });

    it('拒绝非 UUID 字符串', () => {
      expect(ensureCleanSessionSlot('not-a-uuid')).toBe(false);
      expect(ensureCleanSessionSlot('')).toBe(false);
      expect(ensureCleanSessionSlot('../etc/passwd')).toBe(false);
    });

    it('接受任何 UUID 形态（isUuidLike 为宽松格式检查）', () => {
      // session-lock-cleanup 的 isUuidLike 仅校验格式，不强制 v4 版本位
      // v4 严格校验由 session-id-mapper 的 assertIsValidUuidV4 负责
      const v4 = '12345678-1234-4234-8234-123456789012';
      const otherUuid = '12345678-1234-1234-8234-123456789012';
      expect(isUuidLike(v4)).toBe(true);
      expect(isUuidLike(otherUuid)).toBe(true);
      expect(isUuidLike('not-a-uuid')).toBe(false);
    });

    it('同名文件（非目录）不被删除（保守策略）', () => {
      const uuid = '12345678-1234-4234-8234-123456789012';
      const filePath = path.join(tmpRoot, uuid);
      fs.writeFileSync(filePath, 'junk');

      const cleaned = ensureCleanSessionSlot(uuid);
      expect(cleaned).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('显式 root 参数覆盖环境变量', () => {
      const overrideRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'cp7-override-'),
      );
      try {
        const uuid = '12345678-1234-4234-8234-123456789012';
        const lockDir = path.join(overrideRoot, uuid);
        fs.mkdirSync(lockDir, { recursive: true });

        const cleaned = ensureCleanSessionSlot(uuid, overrideRoot);
        expect(cleaned).toBe(true);
        expect(fs.existsSync(lockDir)).toBe(false);
      } finally {
        fs.rmSync(overrideRoot, { recursive: true, force: true });
      }
    });
  });

  describe('清理边界契约（§6.1.6.2）', () => {
    it('只清理 session-env/<uuid>/，不触及 projects/todos/shell-snapshots', () => {
      const uuid = '12345678-1234-4234-8234-123456789012';
      const lockDir = path.join(tmpRoot, uuid);
      fs.mkdirSync(lockDir, { recursive: true });

      // 模拟其它"禁止清理"目录（这里验证函数本身不会误动外部路径）
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'cp7-outside-'),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, 'keep.json'), 'keep');

        ensureCleanSessionSlot(uuid);

        expect(fs.existsSync(lockDir)).toBe(false);
        expect(fs.existsSync(path.join(outsideDir, 'keep.json'))).toBe(true);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('getSessionEnvRoot 尊重 PROJMNT4CLAUDE_SESSION_ENV_ROOT', () => {
      expect(getSessionEnvRoot()).toBe(tmpRoot);
    });

    it('getSessionEnvRoot 回退到 ~/.claude/session-env（无 override 时）', () => {
      delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
      const expected = path.join(os.homedir(), '.claude', 'session-env');
      expect(getSessionEnvRoot()).toBe(expected);
    });
  });

  describe('listOrphanedSessions & cleanupOrphanedSessions', () => {
    it('列出不在 knownCliUuids 中的孤儿锁', () => {
      const known = 'aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc';
      const orphan = '11111111-2222-4222-8222-333333333333';
      fs.mkdirSync(path.join(tmpRoot, known), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, orphan), { recursive: true });

      const orphans = listOrphanedSessions(new Set([known]));
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.cliUuid).toBe(orphan);
    });

    it('忽略非 UUID 目录', () => {
      fs.mkdirSync(path.join(tmpRoot, 'random-dir'), { recursive: true });
      fs.mkdirSync(
        path.join(tmpRoot, '11111111-2222-4222-8222-333333333333'),
        { recursive: true },
      );

      const orphans = listOrphanedSessions(new Set());
      expect(orphans).toHaveLength(1);
    });

    it('批量清理孤儿锁', () => {
      const orphan = '11111111-2222-4222-8222-333333333333';
      const orphanDir = path.join(tmpRoot, orphan);
      fs.mkdirSync(orphanDir, { recursive: true });

      const orphans = listOrphanedSessions(new Set());
      const cleaned = cleanupOrphanedSessions(orphans);
      expect(cleaned).toBe(1);
      expect(fs.existsSync(orphanDir)).toBe(false);
    });

    it('空根目录返回空列表', () => {
      expect(listOrphanedSessions(new Set())).toEqual([]);
    });
  });
});
