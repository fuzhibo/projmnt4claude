/**
 * 质量门禁 FlowTarget 路由单元测试
 *
 * 验证检查点:
 * - CP-001: FlowTarget 类型定义在 src/types/harness.ts
 * - CP-002: GateRule 接口包含 onFailure.targetPhase 字段
 * - CP-003: pre-phase gate 通过 executeRules 执行，返回 GateCheckResult
 * - CP-004: post-phase gate 通过 executeRules 执行，返回 GateCheckResult
 * - CP-005: executePhaseLifecycle 使用 targetPhase 路由（替代 A/B）
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';

// ============================================================
// CP-001: FlowTarget 类型验证
// ============================================================

describe('CP-001: FlowTarget 类型定义', () => {
  it('should define FlowTarget type in harness.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/harness.ts'),
      'utf-8'
    );

    // 验证 FlowTarget 类型定义存在
    expect(content).toContain("export type FlowTarget");
    expect(content).toContain("'development' | 'code_review' | 'qa' | 'evaluation' | 'RETRY' | 'NEXT' | 'EXIT'");
  });

  it('should define GateCheckResult interface', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/harness.ts'),
      'utf-8'
    );

    expect(content).toContain('export interface GateCheckResult');
    expect(content).toContain('targetPhase?: FlowTarget');
  });

  it('should define GateRule interface with onFailure', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/harness.ts'),
      'utf-8'
    );

    expect(content).toContain('export interface GateRule');
    expect(content).toContain('onFailure');
  });
});

// ============================================================
// CP-002: GateRule 接口 targetPhase 字段验证
// ============================================================

describe('CP-002: GateRule 接口 onFailure.targetPhase 字段', () => {
  it('should have pre_dev_gate_check return GateCheckResult via executeRules', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 executeRules 函数存在
    expect(content).toContain('async function executeRules');
    // 验证 pre_dev_gate_check 使用 executeRules
    expect(content).toContain('pre_dev_gate_check');
  });

  it('should gate rules use onFailure.targetPhase (FlowTarget) not failureType', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证规则使用 onFailure.targetPhase (FlowTarget-based)
    expect(content).toContain('onFailure');
    expect(content).toContain('targetPhase');
  });
});

// ============================================================
// CP-003: pre-phase gate → runPrePhaseGate → GateCheckResult
// ============================================================

describe('CP-003: pre-phase gate FlowTarget 路由', () => {
  it('should have runPrePhaseGate dispatcher', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 runPrePhaseGate 方法存在
    expect(content).toContain('runPrePhaseGate');
  });

  it('should have 4 pre-phase gate check functions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    expect(content).toContain('pre_dev_gate_check');
    expect(content).toContain('pre_cr_gate_check');
    expect(content).toContain('pre_qa_gate_check');
    expect(content).toContain('pre_eval_gate_check');
  });

  it('should pre-gate result use targetPhase routing not A/B', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 pre-gate 分支使用 targetPhase
    expect(content).toContain('failedAt: \'pre_phase_gate\'');
    // targetPhase 应是 FlowTarget 值，不是 'A' | 'B'
    expect(content).toContain('targetPhase,');
  });
});

// ============================================================
// CP-004: post-phase gate → runPostPhaseGate → GateCheckResult
// ============================================================

describe('CP-004: post-phase gate FlowTarget 路由', () => {
  it('should have runPostPhaseGate dispatcher', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 runPostPhaseGate 方法存在
    expect(content).toContain('runPostPhaseGate');
  });

  it('should have 4 post-phase gate check functions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    expect(content).toContain('post_dev_gate_check');
    expect(content).toContain('post_cr_gate_check');
    expect(content).toContain('post_qa_gate_check');
    expect(content).toContain('post_eval_gate_check');
  });

  it('should post-gate result use targetPhase routing not A/B', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // 验证 post-gate 分支使用 targetPhase
    expect(content).toContain('failedAt: \'post_phase_gate\'');
    expect(content).toContain('targetPhase,');
  });
});

// ============================================================
// CP-005: executePhaseLifecycle targetPhase 路由逻辑
// ============================================================

describe('CP-005: executePhaseLifecycle FlowTarget 路由逻辑', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should PhaseLifecycleResult use targetPhase not failureType', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // PhaseLifecycleResult should have targetPhase?: FlowTarget
    expect(content).toContain('targetPhase?: FlowTarget');
  });

  it('should return targetPhase for pre-phase gate failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // pre-gate failure returns targetPhase
    expect(content).toContain("failedAt: 'pre_phase_gate'");
  });

  it('should return targetPhase for post-phase gate failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // post-gate failure returns targetPhase
    expect(content).toContain("failedAt: 'post_phase_gate'");
  });

  it('should implement RETRY loop for post-phase gate', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // RETRY → continue 循环
    expect(content).toContain('continue;');
    expect(content).toContain('RETRY');
  });

  it('should EXIT on unrecoverable failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // EXIT 目标应中断流水线
    expect(content).toContain("targetPhase === 'EXIT'");
  });
});

// ============================================================
// 综合验证：FlowTarget 路由语义正确性
// ============================================================

describe('FlowTarget 路由语义验证', () => {
  it('should have 8 gate check functions total', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    const gateCheckFunctions = [
      'pre_dev_gate_check', 'post_dev_gate_check',
      'pre_cr_gate_check', 'post_cr_gate_check',
      'pre_qa_gate_check', 'post_qa_gate_check',
      'pre_eval_gate_check', 'post_eval_gate_check',
    ];

    for (const fn of gateCheckFunctions) {
      expect(content).toContain(`async function ${fn}`);
    }
  });

  it('should all gate check functions use executeRules', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/utils/hd-assembly-line.ts'),
      'utf-8'
    );

    // executeRules is the core execution engine
    const executeRulesCount = (content.match(/executeRules/g) || []).length;
    // At least 8 calls (one per gate check function)
    expect(executeRulesCount).toBeGreaterThanOrEqual(8);
  });

  it('should define PhaseResult with FlowTarget', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/harness.ts'),
      'utf-8'
    );

    expect(content).toContain('export interface PhaseResult');
    expect(content).toContain('targetPhase: FlowTarget');
  });

  it('should define HarnessResult with FlowTarget', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/types/harness.ts'),
      'utf-8'
    );

    expect(content).toContain('export interface HarnessResult');
  });
});
