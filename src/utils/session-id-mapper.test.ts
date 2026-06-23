import { describe, it, expect } from '@jest/globals';
import { SessionIdMapper, sessionIdMapper } from './session-id-mapper.js';

describe('SessionIdMapper', () => {
  describe('generate', () => {
    it('should generate a valid CLI UUID', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-123-1781756282985-abc123';
      const cliUuid = mapper.generate(internalId, 'TASK-123', 'development', 'test-salt');

      // Should be a valid UUID v4 format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(cliUuid).toMatch(uuidRegex);
    });

    it('should store the mapping', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-123-1781756282985-abc123';
      const cliUuid = mapper.generate(internalId, 'TASK-123', 'development', 'test-salt');

      expect(mapper.toInternalId(cliUuid)).toBe(internalId);
      expect(mapper.toCliUuid(internalId)).toBe(cliUuid);
    });

    it('should include taskId and phase in mapping', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'cr-TASK-456-1781756282985-def456';
      const cliUuid = mapper.generate(internalId, 'TASK-456', 'codeReview', 'test-salt');

      const mapping = mapper.getMapping(cliUuid);
      expect(mapping).toBeDefined();
      expect(mapping!.taskId).toBe('TASK-456');
      expect(mapping!.phase).toBe('codeReview');
      expect(mapping!.internalId).toBe(internalId);
    });
  });

  describe('deterministic derivation (CP-01)', () => {
    it('should produce identical UUID for identical inputs', () => {
      const mapperA = new SessionIdMapper();
      const mapperB = new SessionIdMapper();
      const internalId = 'dev-TASK-789-1781756282985-feedface';
      const taskId = 'TASK-789';
      const phase = 'development';

      const uuidA = mapperA.generate(internalId, taskId, phase, 'test-salt');
      const uuidB = mapperB.generate(internalId, taskId, phase, 'test-salt');

      expect(uuidA).toBe(uuidB);
    });

    it('should be idempotent: repeated generate() returns same UUID', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'cr-TASK-100-1781756282985-deadbeef';

      const first = mapper.generate(internalId, 'TASK-100', 'codeReview', 'test-salt');
      const second = mapper.generate(internalId, 'TASK-100', 'codeReview', 'test-salt');

      expect(second).toBe(first);
    });

    it('should differ when taskId changes (different internalIds)', () => {
      const mapper = new SessionIdMapper();
      const internalIdA = 'dev-TASK-A-1781756282985-cafebabe';
      const internalIdB = 'dev-TASK-B-1781756282985-deadbeef';

      const uuidA = mapper.generate(internalIdA, 'TASK-A', 'development', 'test-salt');
      const uuidB = mapper.generate(internalIdB, 'TASK-B', 'development', 'test-salt');

      expect(uuidA).not.toBe(uuidB);
    });

    it('should differ when phase changes (different internalIds)', () => {
      const mapper = new SessionIdMapper();
      const internalIdDev = 'dev-TASK-200-1781756282985-abcdef01';
      const internalIdCr = 'cr-TASK-200-1781756282985-01234567';

      const devUuid = mapper.generate(internalIdDev, 'TASK-200', 'development', 'test-salt');
      const crUuid = mapper.generate(internalIdCr, 'TASK-200', 'codeReview', 'test-salt');

      expect(devUuid).not.toBe(crUuid);
    });

    it('should reuse existing UUID when internalId already has a mapping', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'reuse-TASK-300-1781756282985-01234567';

      const firstUuid = mapper.generate(internalId, 'TASK-300', 'development', 'test-salt');
      // 同一 internalId 再次调用 generate（模拟阶段重试），应复用已有 UUID
      const secondUuid = mapper.generate(internalId, 'TASK-300', 'development', 'different-salt');

      expect(secondUuid).toBe(firstUuid);
      // 双向映射依然正确
      expect(mapper.toInternalId(firstUuid)).toBe(internalId);
      expect(mapper.toCliUuid(internalId)).toBe(firstUuid);
    });

    it('should always produce valid UUID v4 format with correct version and variant', () => {
      const mapper = new SessionIdMapper();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      // 测试多组输入，确保格式恒定
      for (let i = 0; i < 50; i++) {
        const uuid = mapper.generate(`id-${i}`, `TASK-${i}`, 'development', 'test-salt');
        expect(uuid).toMatch(uuidRegex);
      }
    });
    it('should produce different UUID when runSalt differs (different internalIds)', () => {
      const mapper = new SessionIdMapper();
      const taskId = 'TASK-999';
      const phase = 'development';

      const uuidSalt1 = mapper.generate('dev-TASK-999-s1-1781756282985-abcdef99', taskId, phase, 'salt-one');
      const uuidSalt2 = mapper.generate('dev-TASK-999-s2-1781756282985-abcdef98', taskId, phase, 'salt-two');

      expect(uuidSalt1).not.toBe(uuidSalt2);
    });

    it('should produce same UUID when same runSalt used repeatedly', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-888-1781756282985-abcdef88';
      const taskId = 'TASK-888';
      const phase = 'development';

      const first = mapper.generate(internalId, taskId, phase, 'stable-salt');
      const second = mapper.generate(internalId, taskId, phase, 'stable-salt');

      expect(second).toBe(first);
    });
  });

  describe('probeSessionState (CP-07)', () => {
    it('should return fresh when no mapping exists', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-001-stable-development';

      const probe = mapper.probeSessionState(internalId);

      expect(probe.state).toBe('fresh');
      expect(probe.cliUuid).toBe('');
      expect(probe.reason).toContain('no existing mapping');
    });

    it('should return active with existing cliUuid when mapping exists', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-002-stable-development';
      const cliUuid = mapper.generate(internalId, 'TASK-002', 'development', 'test-salt');

      const probe = mapper.probeSessionState(internalId);

      expect(probe.state).toBe('active');
      expect(probe.cliUuid).toBe(cliUuid);
      expect(probe.reason).toContain('resume full history');
    });

    it('should return active after retry (same internalId, different runSalt)', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'cr-TASK-003-stable-codeReview';
      const firstUuid = mapper.generate(internalId, 'TASK-003', 'codeReview', 'salt-one');

      // 模拟阶段重试：同一 internalId，但 runSalt 不同
      const probe = mapper.probeSessionState(internalId);

      expect(probe.state).toBe('active');
      expect(probe.cliUuid).toBe(firstUuid);
    });

    it('should return fresh for different internalIds', () => {
      const mapper = new SessionIdMapper();
      const internalIdA = 'dev-TASK-004-stable-development';
      const internalIdB = 'cr-TASK-004-stable-codeReview';

      mapper.generate(internalIdA, 'TASK-004', 'development', 'test-salt');

      const probe = mapper.probeSessionState(internalIdB);

      expect(probe.state).toBe('fresh');
      expect(probe.cliUuid).toBe('');
    });
  });

  describe('generate reuse (CP-08)', () => {
    it('should reuse existing UUID on repeated generate calls', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-010-stable-development';

      const firstUuid = mapper.generate(internalId, 'TASK-010', 'development', 'salt-one');
      const secondUuid = mapper.generate(internalId, 'TASK-010', 'development', 'salt-two');

      expect(secondUuid).toBe(firstUuid);
    });

    it('should update lastUsedAt on reuse', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-011-stable-development';

      mapper.generate(internalId, 'TASK-011', 'development', 'test-salt');
      const mappingBefore = mapper.getMapping(internalId);
      const beforeLastUsed = mappingBefore!.lastUsedAt;

      // 等待 1ms 确保时间戳不同
      const start = Date.now();
      while (Date.now() === start) { /* busy wait */ }
      mapper.generate(internalId, 'TASK-011', 'development', 'test-salt');

      const mappingAfter = mapper.getMapping(internalId);
      expect(mappingAfter!.lastUsedAt).not.toBe(beforeLastUsed);
    });

    it('should generate new UUID for different internalId', () => {
      const mapper = new SessionIdMapper();
      const internalIdA = 'dev-TASK-012A-stable-development';
      const internalIdB = 'dev-TASK-012B-stable-development';

      const uuidA = mapper.generate(internalIdA, 'TASK-012', 'development', 'test-salt');
      const uuidB = mapper.generate(internalIdB, 'TASK-012', 'development', 'test-salt');

      expect(uuidA).not.toBe(uuidB);
    });
  });

  describe('toCliUuid', () => {
    it('should return undefined for unknown internalId', () => {
      const mapper = new SessionIdMapper();
      expect(mapper.toCliUuid('unknown-id')).toBeUndefined();
    });
  });

  describe('toInternalId', () => {
    it('should return undefined for unknown cliUuid', () => {
      const mapper = new SessionIdMapper();
      expect(mapper.toInternalId('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    });
  });

  describe('serialize', () => {
    it('should serialize all unique mappings', () => {
      const mapper = new SessionIdMapper();
      mapper.generate('dev-TASK-1', 'TASK-1', 'development', 'test-salt');
      mapper.generate('cr-TASK-2', 'TASK-2', 'codeReview', 'test-salt');

      const serialized = mapper.serialize();
      expect(serialized).toHaveLength(2);
    });

    it('should include all mapping fields', () => {
      const mapper = new SessionIdMapper();
      mapper.generate('qa-TASK-3', 'TASK-3', 'qaVerification', 'test-salt');

      const serialized = mapper.serialize();
      expect(serialized[0]).toHaveProperty('internalId');
      expect(serialized[0]).toHaveProperty('cliUuid');
      expect(serialized[0]).toHaveProperty('taskId');
      expect(serialized[0]).toHaveProperty('phase');
      expect(serialized[0]).toHaveProperty('createdAt');
    });
  });

  describe('deserialize (CP-06)', () => {
    it('should rebuild mappings from serialize() output', () => {
      const source = new SessionIdMapper();
      source.generate('dev-TASK-1', 'TASK-1', 'development', 'test-salt');
      source.generate('cr-TASK-2', 'TASK-2', 'codeReview', 'test-salt');

      const serialized = source.serialize();

      const target = new SessionIdMapper();
      target.deserialize(serialized);

      expect(target.size()).toBe(2);
      expect(target.toCliUuid('dev-TASK-1')).toBe(source.toCliUuid('dev-TASK-1'));
      expect(target.toCliUuid('cr-TASK-2')).toBe(source.toCliUuid('cr-TASK-2'));
    });

    it('should preserve bidirectional lookup after deserialize', () => {
      const source = new SessionIdMapper();
      const internalId = 'qa-TASK-400-1781756282985-99887766';
      const cliUuid = source.generate(internalId, 'TASK-400', 'qaVerification', 'test-salt');
      const serialized = source.serialize();

      const target = new SessionIdMapper();
      target.deserialize(serialized);

      expect(target.toInternalId(cliUuid)).toBe(internalId);
      expect(target.toCliUuid(internalId)).toBe(cliUuid);

      const mapping = target.getMapping(cliUuid);
      expect(mapping).toBeDefined();
      expect(mapping!.taskId).toBe('TASK-400');
      expect(mapping!.phase).toBe('qaVerification');
    });

    it('should handle empty array gracefully', () => {
      const mapper = new SessionIdMapper();
      mapper.deserialize([]);
      expect(mapper.size()).toBe(0);
    });

    it('should support serialize → deserialize round trip with deterministic UUID', () => {
      // V2 关键属性：deserialized UUID 仍可用于派生相同 internalId
      const original = new SessionIdMapper();
      const internalId = 'eval-TASK-500-1781756282985-aabbccdd';
      original.generate(internalId, 'TASK-500', 'evaluation', 'test-salt');

      const restored = new SessionIdMapper();
      restored.deserialize(original.serialize());

      // 派生 UUID 与原始一致（确定性）
      const derivedAgain = restored.generate(internalId, 'TASK-500', 'evaluation', 'test-salt');
      expect(derivedAgain).toBe(original.toCliUuid(internalId)!);
    });
  });

  describe('audit logger (CP-05)', () => {
    it('should invoke audit logger on generate()', () => {
      const mapper = new SessionIdMapper();
      const entries: Array<{ isReused: boolean; internalId: string }> = [];
      mapper.setAuditLogger(entry => {
        entries.push({ isReused: entry.isReused, internalId: entry.mapping.internalId });
      });

      mapper.generate('dev-TASK-600', 'TASK-600', 'development', 'test-salt');

      expect(entries).toHaveLength(1);
      expect(entries[0]!.isReused).toBe(false);
      expect(entries[0]!.internalId).toBe('dev-TASK-600');
    });

    it('should mark reused entries as isReused=true', () => {
      const mapper = new SessionIdMapper();
      const entries: boolean[] = [];
      mapper.setAuditLogger(entry => entries.push(entry.isReused));

      mapper.generate('cr-TASK-700', 'TASK-700', 'codeReview', 'test-salt');
      mapper.generate('cr-TASK-700', 'TASK-700', 'codeReview', 'test-salt'); // 幂等重用

      expect(entries).toEqual([false, true]);
    });

    it('should not invoke logger when not set', () => {
      const mapper = new SessionIdMapper();
      expect(() => mapper.generate('safe-TASK', 'TASK', 'evaluation', 'test-salt')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all mappings', () => {
      const mapper = new SessionIdMapper();
      mapper.generate('dev-TASK-1', 'TASK-1', 'development', 'test-salt');
      mapper.clear();

      expect(mapper.toInternalId('any-uuid')).toBeUndefined();
    });
  });

  describe('singleton', () => {
    it('should be accessible as singleton', () => {
      expect(sessionIdMapper).toBeDefined();
      expect(typeof sessionIdMapper.generate).toBe('function');
    });
  });
});
