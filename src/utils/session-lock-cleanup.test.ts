import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ensureCleanSessionSlot,
  listOrphanedSessions,
  cleanupOrphanedSessions,
  isUuidLike,
  getSessionEnvRoot,
} from './session-lock-cleanup.js';

const VALID_UUID_A = '6b446e27-8ead-4c31-9e6c-9f3d2a1b8c5f';
const VALID_UUID_B = '7c557f38-9fbe-5d42-af7d-0a4e3b2c9d6a';
const VALID_UUID_C = '8d668049-acdf-6e53-b08e-1b5f4c3d0e7b';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-env-test-'));
}

function mkdir(root: string, uuid: string): string {
  const dir = path.join(root, uuid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('session-lock-cleanup', () => {
  describe('isUuidLike', () => {
    it('accepts valid UUID v4 strings', () => {
      expect(isUuidLike(VALID_UUID_A)).toBe(true);
      expect(isUuidLike(VALID_UUID_B)).toBe(true);
    });

    it('rejects malformed strings', () => {
      expect(isUuidLike('not-a-uuid')).toBe(false);
      expect(isUuidLike('')).toBe(false);
      expect(isUuidLike('12345678-1234-1234-1234-123456789012')).toBe(false); // wrong version
    });
  });

  describe('getSessionEnvRoot', () => {
    afterEach(() => {
      delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
    });

    it('uses override when env var is set', () => {
      process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT = '/tmp/custom-env';
      expect(getSessionEnvRoot()).toBe('/tmp/custom-env');
    });

    it('falls back to ~/.claude/session-env when no override', () => {
      delete process.env.PROJMNT4CLAUDE_SESSION_ENV_ROOT;
      const expected = path.join(os.homedir(), '.claude', 'session-env');
      expect(getSessionEnvRoot()).toBe(expected);
    });
  });

  describe('ensureCleanSessionSlot (CP-02)', () => {
    let root: string;

    beforeEach(() => {
      root = makeTempRoot();
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns false when no residue exists', () => {
      const result = ensureCleanSessionSlot(VALID_UUID_A, root);
      expect(result).toBe(false);
    });

    it('removes residue directory and returns true', () => {
      mkdir(root, VALID_UUID_A);
      expect(fs.existsSync(path.join(root, VALID_UUID_A))).toBe(true);

      const result = ensureCleanSessionSlot(VALID_UUID_A, root);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(root, VALID_UUID_A))).toBe(false);
    });

    it('removes residue directory with files inside', () => {
      const dir = mkdir(root, VALID_UUID_A);
      fs.writeFileSync(path.join(dir, 'lock.json'), '{"pid":12345}');
      fs.writeFileSync(path.join(dir, 'env'), 'FOO=bar');

      const result = ensureCleanSessionSlot(VALID_UUID_A, root);

      expect(result).toBe(true);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('returns false for invalid UUID input', () => {
      const result = ensureCleanSessionSlot('not-a-uuid', root);
      expect(result).toBe(false);
    });

    it('returns false and does not delete if path is a file not directory', () => {
      const filePath = path.join(root, VALID_UUID_A);
      fs.writeFileSync(filePath, 'content');

      const result = ensureCleanSessionSlot(VALID_UUID_A, root);

      expect(result).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('is idempotent: second call returns false', () => {
      mkdir(root, VALID_UUID_A);

      const first = ensureCleanSessionSlot(VALID_UUID_A, root);
      const second = ensureCleanSessionSlot(VALID_UUID_A, root);

      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  describe('listOrphanedSessions (CP-04)', () => {
    let root: string;

    beforeEach(() => {
      root = makeTempRoot();
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns empty array when root does not exist', () => {
      const missing = path.join(root, 'does-not-exist');
      const orphans = listOrphanedSessions(new Set(), missing);
      expect(orphans).toEqual([]);
    });

    it('returns empty array when no sessions exist', () => {
      const orphans = listOrphanedSessions(new Set(), root);
      expect(orphans).toEqual([]);
    });

    it('returns all UUID dirs as orphans when knownCliUuids is empty', () => {
      mkdir(root, VALID_UUID_A);
      mkdir(root, VALID_UUID_B);

      const orphans = listOrphanedSessions(new Set(), root);

      expect(orphans).toHaveLength(2);
      const uuids = orphans.map(o => o.cliUuid).sort();
      expect(uuids).toEqual([VALID_UUID_A, VALID_UUID_B]);
    });

    it('excludes UUIDs in knownCliUuids', () => {
      mkdir(root, VALID_UUID_A);
      mkdir(root, VALID_UUID_B);
      mkdir(root, VALID_UUID_C);

      const orphans = listOrphanedSessions(
        new Set([VALID_UUID_A, VALID_UUID_C]),
        root,
      );

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.cliUuid).toBe(VALID_UUID_B);
    });

    it('skips non-UUID entries', () => {
      fs.mkdirSync(path.join(root, 'random-dir'), { recursive: true });
      fs.mkdirSync(path.join(root, '12345678-1234-1234-1234-123456789012'), { recursive: true }); // wrong version
      mkdir(root, VALID_UUID_A);

      const orphans = listOrphanedSessions(new Set(), root);

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.cliUuid).toBe(VALID_UUID_A);
    });

    it('includes mtime in ISO format', () => {
      mkdir(root, VALID_UUID_A);

      const orphans = listOrphanedSessions(new Set(), root);

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns lockDir as absolute path', () => {
      mkdir(root, VALID_UUID_A);

      const orphans = listOrphanedSessions(new Set(), root);

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.lockDir).toBe(path.join(root, VALID_UUID_A));
      expect(path.isAbsolute(orphans[0]!.lockDir)).toBe(true);
    });
  });

  describe('cleanupOrphanedSessions', () => {
    let root: string;

    beforeEach(() => {
      root = makeTempRoot();
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('deletes all orphan directories and returns count', () => {
      mkdir(root, VALID_UUID_A);
      mkdir(root, VALID_UUID_B);

      const orphans = listOrphanedSessions(new Set(), root);
      const cleaned = cleanupOrphanedSessions(orphans);

      expect(cleaned).toBe(2);
      expect(fs.existsSync(path.join(root, VALID_UUID_A))).toBe(false);
      expect(fs.existsSync(path.join(root, VALID_UUID_B))).toBe(false);
    });

    it('returns 0 for empty list', () => {
      expect(cleanupOrphanedSessions([])).toBe(0);
    });

    it('continues on partial failure', () => {
      mkdir(root, VALID_UUID_A);
      const orphans = listOrphanedSessions(new Set(), root);
      // 注入一个不存在的路径
      orphans.push({
        cliUuid: VALID_UUID_B,
        lockDir: path.join(root, 'nonexistent'),
        mtime: new Date().toISOString(),
      });

      const cleaned = cleanupOrphanedSessions(orphans);
      // 第一个成功删除，第二个 rmSync force:true 不抛错，也算 cleaned++
      // 实际行为：rmSync force:true 对不存在路径不抛错
      expect(cleaned).toBe(2);
      expect(fs.existsSync(path.join(root, VALID_UUID_A))).toBe(false);
    });
  });

  describe('integration: clean → list → cleanup', () => {
    let root: string;

    beforeEach(() => {
      root = makeTempRoot();
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('full workflow: pre-clean residue, then scan orphans', () => {
      // 准备：UUID_A 是本次要用的，已存在残留；UUID_B 是上次崩溃残留
      mkdir(root, VALID_UUID_A);
      mkdir(root, VALID_UUID_B);

      // Step 1: 清理 UUID_A 残留
      expect(ensureCleanSessionSlot(VALID_UUID_A, root)).toBe(true);

      // Step 2: UUID_B 仍在，应被列为孤儿
      const orphans = listOrphanedSessions(new Set([VALID_UUID_A]), root);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.cliUuid).toBe(VALID_UUID_B);

      // Step 3: 批量清理孤儿
      const cleaned = cleanupOrphanedSessions(orphans);
      expect(cleaned).toBe(1);

      // 最终：root 应为空
      const remaining = fs.readdirSync(root);
      expect(remaining).toEqual([]);
    });
  });
});
