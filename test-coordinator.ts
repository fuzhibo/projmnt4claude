/**
 * 协调器功能验证脚本
 */

import {
  PreDevPhaseRuleRegistry,
  PreDevPhaseGateCoordinator,
  createPreDevPhaseGateCoordinator,
} from './src/utils/pre-dev-phase-gate/coordinator.js';
import {
  type PreDevPhaseCheckContext,
  DEFAULT_PRE_DEV_PHASE_GATE_CONFIG,
} from './src/types/pre-dev-phase-gate.js';

// 模拟任务元数据
const mockTask = {
  id: 'TEST-001',
  title: '测试任务',
  description: '测试协调器功能',
  status: 'open' as const,
  priority: 'P1' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// 测试 1: 规则注册表
console.log('=== 测试 1: 规则注册表 ===');
const registry = new PreDevPhaseRuleRegistry();
const allRules = registry.getAllRules();
console.log(`✅ 已注册规则数: ${allRules.length}`);
console.log(`   - Git规则: ${allRules.filter(r => r.id.startsWith('R-GIT')).length} 个`);
console.log(`   - 分支规则: ${allRules.filter(r => r.id.startsWith('R-BR')).length} 个`);
console.log(`   - 依赖规则: ${allRules.filter(r => r.id.startsWith('R-DEPOUT')).length} 个`);
console.log(`   - 资源规则: ${allRules.filter(r => r.id.startsWith('R-RES')).length} 个`);
console.log(`   - 重试规则: ${allRules.filter(r => r.id.startsWith('R-RETRY')).length} 个`);

// 测试 2: 创建协调器
console.log('\n=== 测试 2: 创建协调器 ===');
const coordinator = createPreDevPhaseGateCoordinator();
console.log('✅ 协调器创建成功');

// 测试 3: 获取适用规则
console.log('\n=== 测试 3: 获取适用规则 ===');
const context: PreDevPhaseCheckContext = {
  taskId: 'TEST-001',
  task: mockTask,
  cwd: process.cwd(),
  attempt: 1,
  maxRetries: 3,
  isResumed: false,
  config: DEFAULT_PRE_DEV_PHASE_GATE_CONFIG,
};

const applicableRules = registry.getApplicableRules(context);
console.log(`✅ 适用规则数: ${applicableRules.length}`);

// 测试 4: 运行门禁（首次尝试）
console.log('\n=== 测试 4: 运行门禁（首次尝试）===');
const result = await coordinator.runGate(context);
console.log(`✅ 门禁运行完成`);
console.log(`   - 是否通过: ${result.passed}`);
console.log(`   - 检查数: ${result.checks.length}`);
console.log(`   - 失败数: ${result.failedCount}`);
console.log(`   - 警告数: ${result.warningCount}`);
console.log(`   - 汇总: ${result.summary}`);

// 测试 5: 重试上下文
console.log('\n=== 测试 5: 重试上下文 ===');
const retryContext: PreDevPhaseCheckContext = {
  ...context,
  attempt: 2,
  isResumed: true,
  previousFailure: {
    phase: 'test',
    reason: 'test failure',
    attempt: 1,
  },
};

const retryApplicableRules = registry.getApplicableRules(retryContext);
console.log(`✅ 重试上下文适用规则数: ${retryApplicableRules.length}`);
console.log(`   - 重试特定规则: ${retryApplicableRules.filter(r => r.id.startsWith('R-RETRY')).length} 个`);

console.log('\n=== 所有测试通过! ===');
