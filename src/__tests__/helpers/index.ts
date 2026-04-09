/**
 * 测试辅助工具统一导出
 *
 * 使用方法:
 * ```typescript
 * import { createMockFs, createTestTask, mockAIResponse } from './helpers';
 * ```
 */

// 文件系统 Mock
export {
  MockFs,
  createMockFs,
  createTestProjectStructure,
  mockFsModule,
  type MockFsEntry,
} from './mock-fs';

// 任务数据生成器
export {
  createTestTask,
  createTaskWithCheckpoints,
  createTaskInStatus,
  createTaskWithPriority,
  createTaskWithDependencies,
  createTaskCollection,
  createTaskChain,
  createBatchTasks,
  MOCK_TASK_TEMPLATES,
  type BatchTaskOptions,
} from './mock-task';

// AI 调用 Mock
export {
  MockAIClient,
  mockAIResponse,
  mockAIStreamResponse,
  createMockAICostSummary,
  mockAIVerdict,
  mockAICheckpointResponse,
  mockAICodeReviewResponse,
  mockDelay,
  AI_VERDICT_TEMPLATES,
  type MockAIResponseOptions,
} from './mock-ai';

// 配置 Mock
export {
  DEFAULT_TEST_CONFIG,
  createTestConfig,
  createMinimalConfig,
  createAIConfig,
  MockConfigValidator,
  mockEnvironment,
  withEnv,
  MockConfigStore,
  TEST_ENVIRONMENTS,
} from './mock-config';

// 自定义断言工具
export {
  AssertionError,
  assertExists,
  assertValidTask,
  assertValidCheckpoint,
  assertMatches,
  assertContains,
  assertHasKey,
  assertStartsWith,
  assertEndsWith,
  assertInRange,
  assertValidDate,
  assertLength,
  assertValidStatusTransition,
  assertNoCircularDependencies,
  Assertions,
} from './assertions';
