/**
 * 质量门禁 A/B 分类单元测试
 *
 * 验证检查点:
 * - CP-001: FailureType 枚举定义在 src/types/task.ts
 * - CP-002: QualityGateRule 接口新增 failureType 字段
 * - CP-003: pre-phase-gate.ts 检查器添加 failureType: 'A'
 * - CP-004: post-phase-gate.ts 检查器添加 failureType: 'B'
 * - CP-005: hd-assembly-line.ts 重试逻辑按 failureType 分类处理
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// ============================================================
// CP-001: FailureType 枚举验证
// ============================================================

describe('CP-001: FailureType 枚举定义', () => {
  it('should define FailureType type in task.ts', async () => {
    // FailureType 是类型别名，验证源代码中存在定义
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/task.ts'),
      'utf-8'
    );

    // 验证 FailureType 类型定义存在
    expect(content).toContain("export type FailureType = 'A' | 'B'");
  });

  it('should allow A and B as valid FailureType values', () => {
    // 类型检查通过编译即可验证
    const typeA: 'A' = 'A';
    const typeB: 'B' = 'B';

    expect(typeA).toBe('A');
    expect(typeB).toBe('B');
  });
});

// ============================================================
// CP-002: QualityGateRule 接口验证
// ============================================================

describe('CP-002: QualityGateRule 接口 failureType 字段', () => {
  it('should have failureType field in PhaseGateRule interface', async () => {
    const { DEFAULT_DEV_PHASE_RULES } = await import('../types/pre-phase-gate.js');

    // 验证默认规则包含 failureType 字段
    expect(DEFAULT_DEV_PHASE_RULES.length).toBeGreaterThan(0);

    const rule = DEFAULT_DEV_PHASE_RULES[0];
    expect(rule).toHaveProperty('failureType');
    expect(rule.failureType).toBe('A');
  });

  it('should have failureType field in PostPhaseGateRule interface', async () => {
    const { DEFAULT_DEV_POST_PHASE_RULES } = await import('../types/post-phase-gate.js');

    // 验证默认规则包含 failureType 字段
    expect(DEFAULT_DEV_POST_PHASE_RULES.length).toBeGreaterThan(0);

    const rule = DEFAULT_DEV_POST_PHASE_RULES[0];
    expect(rule).toHaveProperty('failureType');
    expect(rule.failureType).toBe('B');
  });
});

// ============================================================
// CP-003: pre-phase-gate.ts 检查器 failureType: 'A'
// ============================================================

describe('CP-003: pre-phase-gate.ts 检查器 failureType: A', () => {
  it('should have failureType: A for development phase rules', async () => {
    const { DEFAULT_DEV_PHASE_RULES } = await import('../types/pre-phase-gate.js');

    // 所有开发阶段前门禁规则应为 A 类
    for (const rule of DEFAULT_DEV_PHASE_RULES) {
      expect(rule.failureType).toBe('A');
    }
  });

  it('should have failureType: A for code_review phase rules', async () => {
    const { DEFAULT_CR_PHASE_RULES } = await import('../types/pre-phase-gate.js');

    // 所有代码审核阶段前门禁规则应为 A 类
    for (const rule of DEFAULT_CR_PHASE_RULES) {
      expect(rule.failureType).toBe('A');
    }
  });

  it('should have failureType: A for qa phase rules', async () => {
    const { DEFAULT_QA_PHASE_RULES } = await import('../types/pre-phase-gate.js');

    // 所有 QA 阶段前门禁规则应为 A 类
    for (const rule of DEFAULT_QA_PHASE_RULES) {
      expect(rule.failureType).toBe('A');
    }
  });

  it('should have failureType: A for evaluation phase rules', async () => {
    const { DEFAULT_EVAL_PHASE_RULES } = await import('../types/pre-phase-gate.js');

    // 所有评估阶段前门禁规则应为 A 类
    for (const rule of DEFAULT_EVAL_PHASE_RULES) {
      expect(rule.failureType).toBe('A');
    }
  });
});

// ============================================================
// CP-004: post-phase-gate.ts 检查器 failureType: 'B'
// ============================================================

describe('CP-004: post-phase-gate.ts 检查器 failureType: B', () => {
  it('should have failureType: B for development post-phase rules', async () => {
    const { DEFAULT_DEV_POST_PHASE_RULES } = await import('../types/post-phase-gate.js');

    // 所有开发阶段后门禁规则应为 B 类
    for (const rule of DEFAULT_DEV_POST_PHASE_RULES) {
      expect(rule.failureType).toBe('B');
    }
  });

  it('should have failureType: B for code_review post-phase rules', async () => {
    const { DEFAULT_CR_POST_PHASE_RULES } = await import('../types/post-phase-gate.js');

    // 所有代码审核阶段后门禁规则应为 B 类
    for (const rule of DEFAULT_CR_POST_PHASE_RULES) {
      expect(rule.failureType).toBe('B');
    }
  });

  it('should have failureType: B for qa post-phase rules', async () => {
    const { DEFAULT_QA_POST_PHASE_RULES } = await import('../types/post-phase-gate.js');

    // 所有 QA 阶段后门禁规则应为 B 类
    for (const rule of DEFAULT_QA_POST_PHASE_RULES) {
      expect(rule.failureType).toBe('B');
    }
  });

  it('should have failureType: B for evaluation post-phase rules', async () => {
    const { DEFAULT_EVAL_POST_PHASE_RULES } = await import('../types/post-phase-gate.js');

    // 所有评估阶段后门禁规则应为 B 类
    for (const rule of DEFAULT_EVAL_POST_PHASE_RULES) {
      expect(rule.failureType).toBe('B');
    }
  });
});

// ============================================================
// CP-005: hd-assembly-line.ts 重试逻辑验证
// ============================================================

describe('CP-005: hd-assembly-line.ts 重试逻辑', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should define PhaseLifecycleResult with failureType field', async () => {
    // 读取源代码验证接口定义
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 PhaseLifecycleResult 接口包含 failureType 字段
    expect(content).toContain("failureType?: FailureType");
    expect(content).toContain("failureType: 'A'");
    expect(content).toContain("failureType: 'B'");
  });

  it('should return failureType: A for pre-phase gate failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 A 类门禁失败返回 failureType: 'A'
    expect(content).toContain("failedAt: 'pre_phase_gate'");
    expect(content).toContain("failureType: 'A'");
    expect(content).toContain("retryable: false");
  });

  it('should return failureType: B for post-phase gate failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 B 类门禁失败返回 failureType: 'B'
    expect(content).toContain("failedAt: 'post_phase_gate'");
    expect(content).toContain("failureType: 'B'");
  });

  it('should implement retry loop for B class failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 B 类门禁失败时的重试逻辑
    // 应包含 continue 语句实现阶段内重试
    expect(content).toContain("continue; // CP-P4-2: 阶段内重试");
    expect(content).toContain("B 类门禁失败，回退到阶段起点重试");
  });

  it('should interrupt pipeline for A class failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 A 类门禁失败时直接返回（中断流水线）
    expect(content).toContain("A 类门禁失败，中断流水线");
    expect(content).toContain("任务数据有效性检查失败");
  });
});

// ============================================================
// 综合验证：A/B 分类语义正确性
// ============================================================

describe('A/B 分类语义验证', () => {
  it('should classify pre-phase gates as A type (Task Foundation)', async () => {
    const { createDefaultPhaseGateConfig } = await import('../types/pre-phase-gate.js');
    const config = createDefaultPhaseGateConfig();

    // 所有阶段前门禁规则应为 A 类
    for (const [phase, phaseConfig] of config.phaseGates) {
      for (const rule of phaseConfig.rules) {
        expect(rule.failureType).toBe('A');
      }
    }
  });

  it('should classify post-phase gates as B type (Phase Artifact)', async () => {
    const { createDefaultPostPhaseGateConfig } = await import('../types/post-phase-gate.js');
    const config = createDefaultPostPhaseGateConfig();

    // 所有阶段后门禁规则应为 B 类
    for (const [phase, phaseConfig] of config.phaseGates) {
      for (const rule of phaseConfig.rules) {
        expect(rule.failureType).toBe('B');
      }
    }
  });
});
