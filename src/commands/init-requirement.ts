import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getTasksDir } from '../utils/path';
import {
  generateNewTaskId,
  writeTaskMeta,
} from '../utils/task';
import { hasValidCheckpoints, displayCheckpointCreationWarning } from './task';
import { syncCheckpointsToMeta } from '../utils/checkpoint';
import type { TaskMeta, TaskPriority, TaskStatus, TaskType } from '../types/task';
import { createDefaultTaskMeta, inferTaskType } from '../types/task';
import { SEPARATOR_WIDTH } from '../utils/format';

/**
 * 需求分析结果接口
 */
interface RequirementAnalysis {
  title: string;
  description: string;
  priority: TaskPriority;
  recommendedRole: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  suggestedCheckpoints: string[];
  potentialDependencies: string[];
}

/**
 * 初始化需求选项
 */
export interface InitRequirementOptions {
  nonInteractive?: boolean;  // 非交互模式：跳过所有确认
  noPlan?: boolean;          // 不询问添加到计划
  skipValidation?: boolean;  // 跳过 checkpoints 质量校验
}

/**
 * 从自然语言需求创建任务
 */
export async function initRequirement(
  description: string,
  cwd: string = process.cwd(),
  options: InitRequirementOptions = {}
): Promise<void> {
  const { nonInteractive = false, noPlan = false, skipValidation = false } = options;

  if (!isInitialized(cwd)) {
    console.error('');
    console.error('❌ 项目未初始化');
    console.error('');
    console.error('  请先运行以下命令初始化项目管理环境:');
    console.error('    projmnt4claude setup');
    console.error('');
    console.error('  初始化后即可使用 init-requirement 创建任务。');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 正在分析需求...');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 分析需求
  const analysis = analyzeRequirement(description);

  // 显示分析结果
  console.log('📋 需求分析结果:');
  console.log('');
  console.log(`  标题: ${analysis.title}`);
  console.log(`  优先级: ${formatPriority(analysis.priority)}`);
  console.log(`  复杂度: ${analysis.estimatedComplexity}`);
  console.log(`  推荐角色: ${analysis.recommendedRole}`);
  console.log('');

  if (analysis.suggestedCheckpoints.length > 0) {
    console.log('  建议检查点:');
    for (const cp of analysis.suggestedCheckpoints) {
      console.log(`    - ${cp}`);
    }
    console.log('');
  }

  if (analysis.potentialDependencies.length > 0) {
    console.log('  潜在依赖:');
    for (const dep of analysis.potentialDependencies) {
      console.log(`    - ${dep}`);
    }
    console.log('');
  }

  // 确认创建（非交互模式自动确认）
  let confirmCreate = { confirm: true };
  if (!nonInteractive) {
    confirmCreate = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '是否基于此分析创建任务?',
      initial: true,
    });
  }

  if (!confirmCreate.confirm) {
    console.log('');
    console.log('ℹ️  已取消任务创建。');
    console.log('   如需重新创建，请再次运行 init-requirement 命令。');
    console.log('');
    return;
  }

  // 允许用户修改（非交互模式使用分析结果）
  let response: { title: string; description: string; priority: string; recommendedRole: string };
  if (nonInteractive) {
    response = {
      title: analysis.title,
      description: analysis.description,
      priority: analysis.priority,
      recommendedRole: analysis.recommendedRole,
    };
  } else {
    const promptResponse = await prompts([
      {
        type: 'text',
        name: 'title',
        message: '任务标题',
        initial: analysis.title,
      },
      {
        type: 'text',
        name: 'description',
        message: '任务描述',
        initial: analysis.description,
      },
      {
        type: 'select',
        name: 'priority',
        message: '优先级',
        choices: [
          { title: '低', value: 'low' },
          { title: '中', value: 'medium', selected: analysis.priority === 'medium' },
          { title: '高', value: 'high', selected: analysis.priority === 'high' },
          { title: '紧急', value: 'urgent', selected: analysis.priority === 'urgent' },
        ],
        initial: analysis.priority === 'low' ? 0 : analysis.priority === 'medium' ? 1 : analysis.priority === 'high' ? 2 : 3,
      },
      {
        type: 'text',
        name: 'recommendedRole',
        message: '推荐角色',
        initial: analysis.recommendedRole,
      },
    ]);
    response = promptResponse as { title: string; description: string; priority: string; recommendedRole: string };
  }

  if (!response.title) {
    console.log('');
    console.log('ℹ️  已取消任务创建（标题不能为空）。');
    console.log('   如需重新创建，请再次运行 init-requirement 命令。');
    console.log('');
    return;
  }

  // 推断任务类型并生成任务ID
  const taskType = inferTaskType(response.title);
  const taskPriority = (response.priority as TaskPriority) || analysis.priority;
  const taskId = generateNewTaskId(cwd, taskType, taskPriority, response.title);

  // 创建任务元数据
  const task = createDefaultTaskMeta(taskId, response.title, taskType);
  task.description = response.description || analysis.description;
  task.priority = response.priority as TaskPriority;
  task.recommendedRole = response.recommendedRole || analysis.recommendedRole;

  // 写入任务
  writeTaskMeta(task, cwd);

  // 创建 checkpoint.md
  const taskDir = path.join(getTasksDir(cwd), taskId);
  const checkpointPath = path.join(taskDir, 'checkpoint.md');
  const checkpoints = analysis.suggestedCheckpoints;

  const checkpointContent = `# ${taskId} 检查点

${checkpoints.map((cp: string) => `- [ ] ${cp}`).join('\n')}
`;
  fs.writeFileSync(checkpointPath, checkpointContent, 'utf-8');

  // 同步检查点到 meta.json
  syncCheckpointsToMeta(taskId, cwd);

  console.log('');
  console.log(`✅ 任务创建成功!`);
  console.log(`   ID: ${taskId}`);
  console.log(`   标题: ${task.title}`);
  console.log(`   优先级: ${formatPriority(task.priority)}`);
  console.log(`   检查点: ${checkpoints.length} 项`);
  console.log('');

  // BUG-002: 校验检查点质量并显示警告（除非使用 --skip-validation）
  if (!skipValidation) {
    const validation = hasValidCheckpoints(checkpointPath, false);
    if (!validation.valid) {
      displayCheckpointCreationWarning(taskId, cwd);
    }
  }

  // 询问是否添加到执行计划（非交互模式或 noPlan 时跳过）
  if (!noPlan && !nonInteractive) {
    const addToPlan = await prompts({
      type: 'confirm',
      name: 'add',
      message: '是否将此任务添加到执行计划?',
      initial: true,
    });

    if (addToPlan.add) {
      // 动态导入 plan 模块
      const planModule = await import('./plan');
      planModule.addTask(taskId);
    }
  }
}

/**
 * 分析自然语言需求
 */
function analyzeRequirement(description: string): RequirementAnalysis {
  const lowerDesc = description.toLowerCase();

  // 检测优先级关键词 (使用 P0-P3 格式)
  let priority: TaskPriority = 'P2'; // 默认中等优先级
  if (lowerDesc.includes('紧急') || lowerDesc.includes('urgent') || lowerDesc.includes('asap') || lowerDesc.includes('立即')) {
    priority = 'P0';
  } else if (lowerDesc.includes('重要') || lowerDesc.includes('important') || lowerDesc.includes('优先') || lowerDesc.includes('high')) {
    priority = 'P1';
  } else if (lowerDesc.includes('低优先级') || lowerDesc.includes('low priority') || lowerDesc.includes('可选') || lowerDesc.includes('optional')) {
    priority = 'P3';
  }

  // 检测推荐角色
  let recommendedRole = 'developer';
  if (lowerDesc.includes('ui') || lowerDesc.includes('界面') || lowerDesc.includes('前端') || lowerDesc.includes('frontend')) {
    recommendedRole = 'frontend';
  } else if (lowerDesc.includes('api') || lowerDesc.includes('后端') || lowerDesc.includes('backend') || lowerDesc.includes('服务端')) {
    recommendedRole = 'backend';
  } else if (lowerDesc.includes('测试') || lowerDesc.includes('test') || lowerDesc.includes('qa')) {
    recommendedRole = 'qa';
  } else if (lowerDesc.includes('文档') || lowerDesc.includes('document') || lowerDesc.includes('readme')) {
    recommendedRole = 'writer';
  } else if (lowerDesc.includes('安全') || lowerDesc.includes('security') || lowerDesc.includes('漏洞')) {
    recommendedRole = 'security';
  } else if (lowerDesc.includes('性能') || lowerDesc.includes('performance') || lowerDesc.includes('优化')) {
    recommendedRole = 'performance';
  } else if (lowerDesc.includes('架构') || lowerDesc.includes('architecture') || lowerDesc.includes('设计')) {
    recommendedRole = 'architect';
  }

  // 检测复杂度
  let estimatedComplexity: 'low' | 'medium' | 'high' = 'medium';
  const complexityKeywords = {
    high: ['重构', 'refactor', '架构', 'architecture', '迁移', 'migrate', '集成', 'integration', '系统'],
    low: ['修复', 'fix', '更新', 'update', '添加', 'add', '修改', 'modify', '调整', 'adjust'],
  };

  const highCount = complexityKeywords.high.filter((kw: string) => lowerDesc.includes(kw)).length;
  const lowCount = complexityKeywords.low.filter((kw: string) => lowerDesc.includes(kw)).length;

  if (highCount > lowCount) {
    estimatedComplexity = 'high';
  } else if (lowCount > highCount) {
    estimatedComplexity = 'low';
  }

  // 生成标题 (提取关键词)
  let title = description;
  if (description.length > 50) {
    // 尝试提取核心动词和名词
    const keywords = description.match(/(?:实现|添加|修复|更新|创建|设计|优化|重构|集成|迁移)[\s\S]{1,30}?/);
    if (keywords && keywords[0]) {
      title = keywords[0].trim();
    } else {
      title = description.substring(0, 50) + '...';
    }
  }

  // 生成建议检查点
  const suggestedCheckpoints: string[] = [];

  if (lowerDesc.includes('api') || lowerDesc.includes('接口')) {
    suggestedCheckpoints.push('设计 API 接口');
    suggestedCheckpoints.push('实现 API 逻辑');
    suggestedCheckpoints.push('编写 API 文档');
    suggestedCheckpoints.push('添加 API 测试');
  }

  if (lowerDesc.includes('ui') || lowerDesc.includes('界面') || lowerDesc.includes('页面')) {
    suggestedCheckpoints.push('设计 UI 原型');
    suggestedCheckpoints.push('实现 UI 组件');
    suggestedCheckpoints.push('添加交互逻辑');
    suggestedCheckpoints.push('响应式适配');
  }

  if (lowerDesc.includes('测试') || lowerDesc.includes('test')) {
    suggestedCheckpoints.push('编写单元测试');
    suggestedCheckpoints.push('编写集成测试');
    suggestedCheckpoints.push('测试覆盖率检查');
  }

  if (lowerDesc.includes('数据库') || lowerDesc.includes('database') || lowerDesc.includes('db')) {
    suggestedCheckpoints.push('设计数据模型');
    suggestedCheckpoints.push('创建数据库迁移');
    suggestedCheckpoints.push('实现数据访问层');
  }

  if (lowerDesc.includes('文档') || lowerDesc.includes('document')) {
    suggestedCheckpoints.push('收集文档需求');
    suggestedCheckpoints.push('编写文档内容');
    suggestedCheckpoints.push('文档审核');
  }

  // 如果没有生成任何检查点，使用通用检查点
  if (suggestedCheckpoints.length === 0) {
    suggestedCheckpoints.push('需求分析与设计');
    suggestedCheckpoints.push('核心功能实现');
    suggestedCheckpoints.push('测试与验证');
    suggestedCheckpoints.push('代码审查');
  }

  // 生成潜在依赖
  const potentialDependencies: string[] = [];

  if (lowerDesc.includes('登录') || lowerDesc.includes('auth') || lowerDesc.includes('认证')) {
    potentialDependencies.push('可能需要先完成用户认证基础功能');
  }

  if (lowerDesc.includes('支付') || lowerDesc.includes('payment')) {
    potentialDependencies.push('可能需要先完成订单系统');
    potentialDependencies.push('可能需要接入第三方支付');
  }

  if (lowerDesc.includes('通知') || lowerDesc.includes('notification')) {
    potentialDependencies.push('可能需要先完成消息队列配置');
  }

  return {
    title,
    description,
    priority,
    recommendedRole,
    estimatedComplexity,
    suggestedCheckpoints,
    potentialDependencies,
  };
}

/**
 * 格式化优先级
 * 支持两种格式: P0/P1/P2/P3/Q1-Q4 和 low/medium/high/urgent
 */
function formatPriority(priority: TaskPriority | string): string {
  const map: Record<string, string> = {
    // P0-P3 格式
    P0: '🔴 P0 紧急',
    P1: '🟠 P1 高',
    P2: '🟡 P2 中',
    P3: '🟢 P3 低',
    // Q1-Q4 象限格式
    Q1: '📊 Q1',
    Q2: '📊 Q2',
    Q3: '📊 Q3',
    Q4: '📊 Q4',
    // low-urgent 格式（兼容旧数据）
    low: '🟢 低',
    medium: '🟡 中',
    high: '🟠 高',
    urgent: '🔴 紧急',
  };
  return map[priority] || `❓ ${priority}`;
}
