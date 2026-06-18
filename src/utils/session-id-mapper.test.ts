import { describe, it, expect } from 'bun:test';
import { SessionIdMapper, sessionIdMapper } from './session-id-mapper.js';

describe('SessionIdMapper', () => {
  describe('generate', () => {
    it('should generate a valid CLI UUID', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-123-1781756282985-abc123';
      const cliUuid = mapper.generate(internalId, 'TASK-123', 'development');

      // Should be a valid UUID v4 format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(cliUuid).toMatch(uuidRegex);
    });

    it('should store the mapping', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'dev-TASK-123-1781756282985-abc123';
      const cliUuid = mapper.generate(internalId, 'TASK-123', 'development');

      expect(mapper.toInternalId(cliUuid)).toBe(internalId);
      expect(mapper.toCliUuid(internalId)).toBe(cliUuid);
    });

    it('should include taskId and phase in mapping', () => {
      const mapper = new SessionIdMapper();
      const internalId = 'cr-TASK-456-1781756282985-def456';
      const cliUuid = mapper.generate(internalId, 'TASK-456', 'codeReview');

      const mapping = mapper.getMapping(cliUuid);
      expect(mapping).toBeDefined();
      expect(mapping!.taskId).toBe('TASK-456');
      expect(mapping!.phase).toBe('codeReview');
      expect(mapping!.internalId).toBe(internalId);
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
      mapper.generate('dev-TASK-1', 'TASK-1', 'development');
      mapper.generate('cr-TASK-2', 'TASK-2', 'codeReview');

      const serialized = mapper.serialize();
      expect(serialized).toHaveLength(2);
    });

    it('should include all mapping fields', () => {
      const mapper = new SessionIdMapper();
      mapper.generate('qa-TASK-3', 'TASK-3', 'qaVerification');

      const serialized = mapper.serialize();
      expect(serialized[0]).toHaveProperty('internalId');
      expect(serialized[0]).toHaveProperty('cliUuid');
      expect(serialized[0]).toHaveProperty('taskId');
      expect(serialized[0]).toHaveProperty('phase');
      expect(serialized[0]).toHaveProperty('createdAt');
    });
  });

  describe('clear', () => {
    it('should remove all mappings', () => {
      const mapper = new SessionIdMapper();
      mapper.generate('dev-TASK-1', 'TASK-1', 'development');
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
