/**
 * Tests for QA Acceptance Criteria System
 *
 * Tests the four-level acceptance criteria verification hierarchy.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { AcceptanceCriteriaParser, parseAcceptanceCriteria } from '../utils/qa-acceptance-criteria-parser.js';
import { QAAcceptanceCriteriaVerifier, verifyQAAcceptanceCriteria } from '../utils/qa-acceptance-criteria-verifier.js';
import type { TaskMeta } from '../types/task.js';
import { createIsolatedTestEnv } from '../utils/test-env.js';

describe('QAAcceptanceCriteriaParser', () => {
  let parser: AcceptanceCriteriaParser;
  let env: ReturnType<typeof createIsolatedTestEnv>;

  beforeEach(async () => {
    env = await createIsolatedTestEnv('qa-acceptance-criteria-parser');
    parser = new AcceptanceCriteriaParser();
  });

  describe('parse', () => {
    it('should parse acceptance criteria section from Chinese header', () => {
      const description = `
## 问题描述
Some problem description.

## 验收标准
- [ ] 所有 3 个文件都已迁移到使用 createIsolatedTestEnv
- [ ] beforeEach 中正确设置 env.mocks
- [ ] afterEach 中调用 env.cleanup()
`;

      const criteria = parser.parse(description);
      expect(criteria.length).toBe(3);
      expect(criteria[0].type).toBe('file_count');
      expect(criteria[0].expected).toBe(3);
      expect(criteria[1].type).toBe('function_call');
      expect(criteria[2].type).toBe('function_call');
    });

    it('should parse acceptance criteria section from English header', () => {
      const description = `
## Acceptance Criteria
- All 5 files migrated to new API
- Call setup() in beforeEach
- Call teardown() in afterEach
`;

      const criteria = parser.parse(description);
      expect(criteria.length).toBe(3);
      expect(criteria[0].type).toBe('file_count');
      expect(criteria[0].expected).toBe(5);
    });

    it('should return empty array when no criteria section', () => {
      const description = `
## 问题描述
Some problem description without criteria.
`;
      const criteria = parser.parse(description);
      expect(criteria.length).toBe(0);
    });

    it('should parse file count patterns', () => {
      const testCases = [
        { text: '所有 3 个文件都已迁移', expected: 3 },
        { text: '5 个文件需要更新', expected: 5 },
        { text: 'all 7 files', expected: 7 },
        { text: '10 files to migrate', expected: 10 },
      ];

      for (const { text, expected } of testCases) {
        const criteria = parser.parse(`## 验收标准\n- ${text}`);
        expect(criteria.length).toBeGreaterThan(0);
        expect(criteria[0].type).toBe('file_count');
        expect(criteria[0].expected).toBe(expected);
      }
    });

    it('should parse file migration patterns', () => {
      const description = `
## 验收标准
- 文件迁移到使用 createIsolatedTestEnv
- Migrated to new API
`;

      const criteria = parser.parse(description);
      expect(criteria.length).toBe(2);
      expect(criteria[0].type).toBe('file_migration');
      expect(criteria[1].type).toBe('file_migration');
    });

    it('should parse function call patterns', () => {
      const description = `
## 验收标准
- beforeEach 中正确设置 env.mocks
- afterEach 中调用 env.cleanup()
- Call setup() in init
`;

      const criteria = parser.parse(description);
      expect(criteria.length).toBe(3);
      expect(criteria.every(c => c.type === 'function_call')).toBe(true);
    });

    it('should handle general criteria without specific patterns', () => {
      const description = `
## 验收标准
- 代码质量符合规范
- 文档已更新
`;

      const criteria = parser.parse(description);
      expect(criteria.length).toBe(2);
      expect(criteria.every(c => c.type === 'general')).toBe(true);
    });
  });

  describe('verify', () => {
    it('should verify file count criterion', () => {
      const criteria = parser.parse(`
## 验收标准
- 所有 3 个文件都已迁移
`);

      const context = {
        affectedFiles: ['file1.ts', 'file2.ts', 'file3.ts'],
        migratedFiles: ['file1.ts', 'file2.ts', 'file3.ts'],
      };

      const verified = parser.verify(criteria, context);
      expect(verified[0].satisfied).toBe(true);
      expect(verified[0].actual).toBe(3);
    });

    it('should detect insufficient file count', () => {
      const criteria = parser.parse(`
## 验收标准
- 所有 5 个文件都已迁移
`);

      const context = {
        affectedFiles: ['file1.ts', 'file2.ts', 'file3.ts'],
        migratedFiles: ['file1.ts', 'file2.ts'],
      };

      const verified = parser.verify(criteria, context);
      expect(verified[0].satisfied).toBe(false);
      expect(verified[0].actual).toBe(2);
    });

    it('should verify function call criterion', () => {
      const criteria = parser.parse(`
## 验收标准
- beforeEach 中正确设置 env.mocks
`);

      const context = {
        functionCalls: ['beforeEach', 'env.mocks'],
      };

      const verified = parser.verify(criteria, context);
      expect(verified[0].satisfied).toBe(true);
    });
  });
});

describe('QAAcceptanceCriteriaVerifier', () => {
  let env: ReturnType<typeof createIsolatedTestEnv>;
  let verifier: QAAcceptanceCriteriaVerifier;

  beforeEach(async () => {
    env = await createIsolatedTestEnv('qa-acceptance-criteria-verifier');
    verifier = new QAAcceptanceCriteriaVerifier(env.tempDir);
  });

  describe('verify', () => {
    it('should verify all four levels', async () => {
      const task: TaskMeta = {
        id: 'test-task-001',
        title: 'Test Task',
        description: `
## 验收标准
- 所有 2 个文件都已迁移
`,
        status: 'in_progress',
        type: 'feature',
        priority: 'P2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [
          {
            id: 'CP-001',
            description: 'Test checkpoint',
            status: 'completed',
            category: 'qa_verification',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        files: ['src/file1.ts', 'src/file2.ts'],
        dependencies: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy: 'cli',
        schemaVersion: 6,
        checkpointPolicy: 'optional',
      };

      const context = {
        migratedFiles: ['src/file1.ts', 'src/file2.ts'],
        testResults: { passed: 5, failed: 0, total: 5 },
      };

      const result = await verifier.verify(task, context);

      // Check that all levels were evaluated
      expect(result.levelResults.has('checkpoint')).toBe(true);
      expect(result.levelResults.has('build')).toBe(true);
      expect(result.levelResults.has('test')).toBe(true);
      expect(result.levelResults.has('criteria')).toBe(true);

      // Check checkpoint level
      const checkpointResult = result.levelResults.get('checkpoint');
      expect(checkpointResult?.passed).toBe(true);

      // Check criteria level
      const criteriaResult = result.levelResults.get('criteria');
      expect(criteriaResult?.criteria?.length).toBe(1);
    });

    it('should pass when no QA checkpoints', async () => {
      const task: TaskMeta = {
        id: 'test-task-002',
        title: 'Test Task',
        description: '',
        status: 'in_progress',
        type: 'feature',
        priority: 'P2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [],
        files: [],
        dependencies: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy: 'cli',
        schemaVersion: 6,
        checkpointPolicy: 'optional',
      };

      const result = await verifier.verify(task);

      const checkpointResult = result.levelResults.get('checkpoint');
      expect(checkpointResult?.passed).toBe(true);
      expect(checkpointResult?.reason).toContain('无 QA 类型检查点');
    });

    it('should fail when QA checkpoints not completed', async () => {
      const task: TaskMeta = {
        id: 'test-task-003',
        title: 'Test Task',
        description: '',
        status: 'in_progress',
        type: 'feature',
        priority: 'P2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [
          {
            id: 'CP-001',
            description: 'Test checkpoint',
            status: 'pending',
            category: 'qa_verification',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        files: [],
        dependencies: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy: 'cli',
        schemaVersion: 6,
        checkpointPolicy: 'optional',
      };

      const result = await verifier.verify(task);

      const checkpointResult = result.levelResults.get('checkpoint');
      expect(checkpointResult?.passed).toBe(false);
      expect(checkpointResult?.reason).toContain('验证失败');
    });

    it('should use test results from context', async () => {
      const task: TaskMeta = {
        id: 'test-task-004',
        title: 'Test Task',
        description: '',
        status: 'in_progress',
        type: 'feature',
        priority: 'P2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [],
        files: [],
        dependencies: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy: 'cli',
        schemaVersion: 6,
        checkpointPolicy: 'optional',
      };

      const context = {
        testResults: { passed: 10, failed: 2, total: 12 },
      };

      const result = await verifier.verify(task, context);

      const testResult = result.levelResults.get('test');
      expect(testResult?.passed).toBe(false);
      expect(testResult?.reason).toContain('2/12');
    });
  });

  describe('formatResult', () => {
    it('should format result for display', async () => {
      const task: TaskMeta = {
        id: 'test-task-005',
        title: 'Test Task',
        description: `
## 验收标准
- 所有 2 个文件都已迁移
`,
        status: 'in_progress',
        type: 'feature',
        priority: 'P2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [],
        files: ['file1.ts', 'file2.ts'],
        dependencies: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy: 'cli',
        schemaVersion: 6,
        checkpointPolicy: 'optional',
      };

      const result = await verifier.verify(task);
      const formatted = verifier.formatResult(result);

      expect(formatted).toContain('QA 验收标准验证结果');
      expect(formatted).toContain('test-task-005');
      expect(formatted).toContain('验证层次结果');
    });
  });
});

describe('parseAcceptanceCriteria (quick function)', () => {
  it('should parse criteria without creating parser instance', () => {
    const description = `
## 验收标准
- 所有 3 个文件都已迁移
`;

    const criteria = parseAcceptanceCriteria(description);
    expect(criteria.length).toBe(1);
    expect(criteria[0].type).toBe('file_count');
  });
});
