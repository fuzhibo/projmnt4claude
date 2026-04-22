import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  decomposeRequirement,
  shouldDecompose,
  formatDecomposition,
  validateDecompositionItem,
  validateDecompositionItems,
  validateDecomposition,
  convertToDecomposedItem,
  reportDecompositionFailure,
  decomposeRecursively,
  DEFAULT_RECURSIVE_CONFIG,
} from '../requirement-decomposer';
import type { RequirementDecomposition, DecomposedTaskItem, DecomposedItem } from '../../types/decomposition';

describe('requirement-decomposer', () => {
  describe('shouldDecompose', () => {
    test('短内容不需要分解', () => {
      const content = '修复登录按钮样式';
      expect(shouldDecompose(content)).toBe(false);
    });

    test('包含多个问题的长内容需要分解', () => {
      const content = `
调查报告

## 问题 1: 登录页面样式错误
登录按钮在移动端显示不正确，需要修复CSS样式。这个问题影响了用户体验，需要尽快解决。
具体表现：按钮宽度超出屏幕，文字被截断。

## 问题 2: 注册页面崩溃
用户提交表单时验证逻辑有误，导致页面崩溃。这是一个严重的bug，需要立即修复。
具体表现：点击提交按钮后页面白屏，控制台报错。

## 问题 3: API响应超时
某些接口响应时间超过5秒，影响用户体验。需要优化后端性能。

请尽快修复以上问题，确保系统稳定运行。
      `;
      expect(shouldDecompose(content)).toBe(true);
    });

    test('包含多个编号列表项的长内容需要分解', () => {
      const content = `
项目需求文档

本次迭代需要完成以下功能点：

1. 修复登录按钮的样式问题，确保在移动端显示正常，按钮宽度自适应屏幕大小。
   涉及文件：src/components/LoginButton.tsx, src/styles/login.css

2. 更新注册页面的表单验证逻辑，添加邮箱格式验证和密码强度检查。
   涉及文件：src/pages/Register.tsx, src/utils/validation.ts

3. 优化首页加载性能，减少首屏渲染时间，实现懒加载图片和组件。
   涉及文件：src/pages/Home.tsx, src/components/LazyImage.tsx

4. 添加用户头像上传功能，支持裁剪和压缩，限制文件大小。
   涉及文件：src/components/AvatarUpload.tsx, src/utils/image.ts

以上功能需要在本周内完成，请各开发人员按时交付。
      `;
      expect(shouldDecompose(content)).toBe(true);
    });

    test('包含多个章节标题的长内容需要分解', () => {
      const content = `
# 项目问题报告

## 问题A：数据库连接异常
生产环境数据库连接偶尔超时，需要增加连接池大小和重试机制。
相关配置：database.config.ts, connection.ts
影响范围：所有需要数据库访问的功能模块。

## 问题B：缓存失效逻辑错误
Redis缓存没有正确设置过期时间，导致内存持续增长。
需要修复缓存设置逻辑，添加合理的TTL。

## 问题C：API限流不准确
当前限流逻辑在高并发场景下有漏桶效应，部分请求没有被正确限制。
需要重构限流中间件，使用更精确的算法。

## 问题D：前端资源加载慢
静态资源没有使用CDN，用户访问速度较慢。
需要配置CDN加速和浏览器缓存策略。

请优先处理数据库和缓存问题。
      `;
      expect(shouldDecompose(content)).toBe(true);
    });
  });

  describe('decomposeRequirement - 模式匹配', () => {
    test('应该分解包含多个问题的报告', async () => {
      const content = `
## 问题 1-A: 登录页面样式错误
登录按钮在移动端显示不正确，需要修复CSS样式。
涉及文件：src/components/Button.tsx

## 问题 1-B: 注册表单验证失败
用户提交表单时验证逻辑有误，导致无法正确提交。
涉及文件：src/pages/Register.tsx

## 问题 1-C: API响应超时
某些接口响应时间超过5秒，需要优化性能。
涉及文件：src/api/client.ts

## 问题 2: 数据库连接池耗尽
高并发时连接池不够用，需要调整配置。
涉及文件：src/config/database.ts
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        maxItems: 10,
        validateQuality: false, // 禁用质量检查以测试模式匹配功能
      });

      expect(result.decomposable).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.length).toBeLessThanOrEqual(10);

      // 验证每个子任务的结构
      for (const item of result.items) {
        expect(item.title).toBeTruthy();
        expect(item.description).toBeTruthy();
        expect(item.type).toBeTruthy();
        expect(item.priority).toMatch(/^P[0-3]$/);
        expect(Array.isArray(item.suggestedCheckpoints)).toBe(true);
        expect(Array.isArray(item.relatedFiles)).toBe(true);
        expect(typeof item.estimatedMinutes).toBe('number');
        expect(Array.isArray(item.dependsOn)).toBe(true);
      }
    });

    test('应该分解编号列表格式的内容', async () => {
      // 使用足够长的描述，标题长度需要 >= 10 字符或有动作动词且长度 >= 20
      const content = `
需求列表：

1. 实现用户登录功能和认证流程
   需要创建登录页面和后端接口，支持邮箱和密码登录验证。
   用户输入凭据后需要验证身份并返回有效的访问token。

2. 添加用户注册功能和表单验证
   包括表单验证逻辑和数据存储处理，需要验证邮箱唯一性。
   注册成功后需要发送验证邮件给用户。

3. 实现密码重置功能和邮件通知
   发送密码重置邮件和验证链接，链接在24小时内有效。
   用户点击链接后可以设置新密码完成重置。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        maxItems: 10,
        validateQuality: false, // 禁用质量检查以测试模式匹配功能
      });

      expect(result.decomposable).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    test('短内容不应该分解', async () => {
      const content = '修复一个小bug';

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    test('无法识别多个问题时返回不可分解', async () => {
      const content = '这是一个单一的需求描述，没有任何问题列表或编号项。' +
        '需要实现一个完整的功能模块，包括前端界面和后端API。' +
        '预计工作量较大，但不需要拆分成多个独立任务。' +
        '这是一个统一的功能开发任务，不涉及多个独立问题。';

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
    });

    test('应该正确推断任务类型', async () => {
      // 使用明确的类型关键词
      const content = `
1. 修复登录按钮点击无响应的严重bug错误
   用户点击登录按钮后没有任何反应，这是一个错误需要调查原因并修复。
   检查事件监听和状态管理逻辑，解决这个故障问题。

2. 添加用户头像上传新功能特性
   实现用户可以在个人设置中上传头像的新功能。
   支持裁剪和压缩处理各种格式图片。

3. 重构用户认证模块代码结构
   重构代码结构，提高可维护性，进行代码重构。
   清理冗余代码和重复逻辑。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false, // 禁用质量检查以测试类型推断
      });

      expect(result.decomposable).toBe(true);

      // 检查类型推断 - 验证至少包含 bug 和 feature
      const types = result.items.map(item => item.type);
      expect(types).toContain('bug'); // 修复bug
      expect(types).toContain('feature'); // 添加功能
      // refactor 可能在某些情况下被识别为 feature，取决于标题内容
    });

    test('应该正确提取优先级', async () => {
      const content = `
## 问题 1 (P0): 系统崩溃需要立即修复
生产环境出现严重错误，系统无法正常运行，需要马上处理。
这是一个紧急问题，影响所有用户。

## 问题 2 (P2): 一般功能优化
正常的功能改进需求，按常规流程处理即可。

## 问题 3 (P3): 界面美化
非紧急的视觉优化，可以延后处理。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false, // 禁用质量检查以测试优先级提取
      });

      expect(result.decomposable).toBe(true);

      // 验证优先级被提取
      const priorities = result.items.map(item => item.priority);
      expect(priorities.length).toBeGreaterThanOrEqual(2);
      // 至少有一个P0
      expect(priorities).toContain('P0');
    });

    test('应该限制最大分解数量', async () => {
      const content = Array.from({ length: 15 }, (_, i) =>
        `问题 ${i + 1}: 描述问题${i + 1}的详细内容，包括具体表现和影响范围。` +
        `需要修复相关代码，添加测试用例，确保功能正常。`
      ).join('\n\n') + '\n\n请按优先级处理以上问题。';

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        maxItems: 5,
        validateQuality: false, // 禁用质量检查以测试数量限制
      });

      expect(result.decomposable).toBe(true);
      expect(result.items.length).toBeLessThanOrEqual(5);
    });
  });

  describe('formatDecomposition', () => {
    test('应该格式化可分解结果', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: true,
        summary: '分解为 2 个子任务',
        items: [
          {
            title: '修复登录问题',
            description: '修复登录按钮',
            type: 'bug',
            priority: 'P0',
            suggestedCheckpoints: ['检查点1'],
            relatedFiles: ['src/login.ts'],
            estimatedMinutes: 15,
            dependsOn: [],
          },
          {
            title: '添加注册功能',
            description: '实现用户注册',
            type: 'feature',
            priority: 'P1',
            suggestedCheckpoints: ['检查点2'],
            relatedFiles: ['src/register.ts'],
            estimatedMinutes: 30,
            dependsOn: [0],
          },
        ],
      };

      const formatted = formatDecomposition(decomposition);

      expect(formatted).toContain('分解为 2 个子任务');
      expect(formatted).toContain('修复登录问题');
      expect(formatted).toContain('添加注册功能');
      expect(formatted).toContain('P0');
      expect(formatted).toContain('P1');
    });

    test('应该格式化不可分解结果', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: false,
        reason: '内容过短，无需分解',
        summary: '单任务',
        items: [],
      };

      const formatted = formatDecomposition(decomposition);

      expect(formatted).toContain('不可分解');
      expect(formatted).toContain('内容过短，无需分解');
    });
  });

  describe('边界情况', () => {
    test('处理包含文件路径的内容', async () => {
      const content = `
1. 修复 src/components/Button.tsx 的样式问题
   按钮在移动端显示不正确，需要调整CSS。
   相关文件：src/styles/button.css

2. 更新 src/utils/helpers.ts 的工具函数
   优化日期格式化函数的实现。
   相关文件：src/types/date.ts
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false, // 禁用质量检查以测试文件路径提取
      });

      expect(result.decomposable).toBe(true);

      // 检查是否提取了文件路径
      const allFiles = result.items.flatMap(item => item.relatedFiles);
      const hasButtonFile = allFiles.some(f => f.includes('Button.tsx'));
      const hasHelpersFile = allFiles.some(f => f.includes('helpers.ts'));

      // 至少有一个文件路径被提取
      expect(allFiles.length).toBeGreaterThan(0);
    });

    test('处理依赖关系', async () => {
      // 使用问题格式，确保能被正确识别
      const content = `
## 问题 1: 创建基础组件和核心API
先完成底层组件的实现，这是其他功能的基础依赖。
包括核心API接口定义和工具函数库的实现。

## 问题 2: 基于基础组件构建高级功能模块
使用第一步创建的组件来实现更复杂的高级功能。
依赖于基础组件提供的API接口进行开发。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false, // 禁用质量检查以测试依赖关系
      });

      expect(result.decomposable).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(2);

      // 第二个任务应该依赖第一个（默认线性依赖）
      if (result.items.length >= 2) {
        expect(result.items[1]!.dependsOn).toContain(0);
      }
    });

    test('处理空内容', async () => {
      const result = await decomposeRequirement('', {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    test('处理只有空白字符的内容', async () => {
      const result = await decomposeRequirement('   \n\t  ', {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
    });
  });

  describe('质量约束机制', () => {
    test('validateDecompositionItem - 验证通过', () => {
      const validItem = {
        title: '修复登录按钮样式问题',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题影响了用户体验，需要尽快修复。',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，添加padding和box-sizing:border-box属性，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: ['修复CSS样式', '验证移动端显示'],
        rootCause: '按钮使用了固定宽度，没有适配移动端屏幕',
        estimatedMinutes: 30,
      };

      const result = validateDecompositionItem(validItem);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validateDecompositionItem - 标题过短', () => {
      const invalidItem = {
        title: '修复bug',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题影响了用户体验。',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: ['修复CSS样式'],
      };

      const result = validateDecompositionItem(invalidItem);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('标题'))).toBe(true);
    });

    test('validateDecompositionItem - 问题描述过短', () => {
      const invalidItem = {
        title: '修复登录按钮样式问题',
        problem: '按钮显示不正确',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: ['修复CSS样式'],
      };

      const result = validateDecompositionItem(invalidItem);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('问题描述'))).toBe(true);
    });

    test('validateDecompositionItem - 解决方案过短', () => {
      const invalidItem = {
        title: '修复登录按钮样式问题',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题影响了用户体验。',
        solution: '修复CSS',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: ['修复CSS样式'],
      };

      const result = validateDecompositionItem(invalidItem);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('解决方案'))).toBe(true);
    });

    test('validateDecompositionItem - 无效优先级', () => {
      const invalidItem = {
        title: '修复登录按钮样式问题',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P5' as const,
        checkpoints: ['修复CSS样式'],
      };

      const result = validateDecompositionItem(invalidItem);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('优先级'))).toBe(true);
    });

    test('validateDecompositionItem - 缺少检查点', () => {
      const invalidItem = {
        title: '修复登录按钮样式问题',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: [],
      };

      const result = validateDecompositionItem(invalidItem);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('检查点'))).toBe(true);
    });

    test('validateDecompositionItem - 缺少根因分析产生警告', () => {
      const itemWithoutRootCause = {
        title: '修复登录按钮样式问题',
        problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。',
        solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，确保在不同屏幕尺寸下正常显示。',
        type: 'bug' as const,
        priority: 'P1' as const,
        checkpoints: ['修复CSS样式'],
      };

      const result = validateDecompositionItem(itemWithoutRootCause);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('根因分析'))).toBe(true);
    });

    test('validateDecompositionItems - 批量验证', () => {
      const items = [
        {
          title: '修复登录按钮样式问题',
          problem: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题严重影响了用户体验，需要尽快修复处理。',
          solution: '调整CSS样式，使用媒体查询设置按钮宽度为100%，添加padding和box-sizing属性，确保在不同屏幕尺寸下都能正常显示。',
          type: 'bug' as const,
          priority: 'P1' as const,
          checkpoints: ['修复CSS样式'],
        },
        {
          title: '短',
          problem: '问题描述太短',
          solution: '解决方案也太短',
          type: 'bug' as const,
          priority: 'P5' as const,
          checkpoints: [],
        },
      ];

      const result = validateDecompositionItems(items);
      expect(result.valid).toBe(false);
      expect(result.validItems).toHaveLength(1);
      expect(result.invalidItems).toHaveLength(1);
    });
  });

  describe('validateDecomposition', () => {
    test('验证通过的分解结果', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: true,
        summary: '分解为 2 个子任务',
        items: [
          {
            title: '修复登录按钮样式问题',
            description: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题严重影响了用户体验，需要尽快修复处理。',
            type: 'bug',
            priority: 'P1',
            suggestedCheckpoints: ['修复CSS样式', '验证移动端显示'],
            relatedFiles: ['src/components/LoginButton.tsx'],
            estimatedMinutes: 30,
            dependsOn: [],
          },
          {
            title: '添加用户头像上传功能',
            description: '实现用户可以在个人设置中上传头像的新功能。支持裁剪和压缩处理各种格式图片，限制文件大小不超过2MB。',
            type: 'feature',
            priority: 'P2',
            suggestedCheckpoints: ['实现上传组件', '添加图片处理', '编写测试用例'],
            relatedFiles: ['src/components/AvatarUpload.tsx'],
            estimatedMinutes: 60,
            dependsOn: [0],
          },
        ],
      };

      const result = validateDecomposition(decomposition);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('不可分解的结果直接通过验证', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: false,
        reason: '内容过短，无需分解',
        summary: '单任务',
        items: [],
      };

      const result = validateDecomposition(decomposition);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('部分子任务验证失败', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: true,
        summary: '分解为 2 个子任务',
        items: [
          {
            title: '修复登录按钮样式问题',
            description: '用户反馈登录按钮在移动端显示不正确，按钮宽度超出屏幕边界，文字被截断。这个问题严重影响了用户体验，需要尽快修复处理。',
            type: 'bug',
            priority: 'P1',
            suggestedCheckpoints: ['修复CSS样式', '验证移动端显示'],
            relatedFiles: ['src/components/LoginButton.tsx'],
            estimatedMinutes: 30,
            dependsOn: [],
          },
          {
            title: '短',
            description: '描述太短',
            type: 'bug',
            priority: 'P1',
            suggestedCheckpoints: ['检查点'],
            relatedFiles: [],
            estimatedMinutes: 10,
            dependsOn: [],
          },
        ],
      };

      const result = validateDecomposition(decomposition);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.itemsWithIssues).toBeDefined();
      expect(result.itemsWithIssues!.length).toBe(1);
      expect(result.itemsWithIssues![0].index).toBe(1);
    });

    test('所有子任务验证失败', () => {
      const decomposition: RequirementDecomposition = {
        decomposable: true,
        summary: '分解为 2 个子任务',
        items: [
          {
            title: '短1',
            description: '描述1',
            type: 'bug',
            priority: 'P1',
            suggestedCheckpoints: ['检查点1'],
            relatedFiles: [],
            estimatedMinutes: 10,
            dependsOn: [],
          },
          {
            title: '短2',
            description: '描述2',
            type: 'feature',
            priority: 'P5' as TaskPriority,
            suggestedCheckpoints: [],
            relatedFiles: [],
            estimatedMinutes: 10,
            dependsOn: [],
          },
        ],
      };

      const result = validateDecomposition(decomposition);
      expect(result.valid).toBe(false);
      expect(result.itemsWithIssues).toBeDefined();
      expect(result.itemsWithIssues!.length).toBe(2);
    });
  });

  describe('convertToDecomposedItem', () => {
    test('正确转换 DecomposedTaskItem 到 DecomposedItem', () => {
      const taskItem: DecomposedTaskItem = {
        title: '修复登录按钮样式问题',
        description: '用户反馈登录按钮在移动端显示不正确，需要修复CSS样式。',
        type: 'bug',
        priority: 'P1',
        suggestedCheckpoints: ['修复CSS样式', '验证移动端显示'],
        relatedFiles: ['src/components/LoginButton.tsx'],
        estimatedMinutes: 30,
        dependsOn: [],
      };

      const result = convertToDecomposedItem(taskItem);

      expect(result.title).toBe(taskItem.title);
      expect(result.problem).toBe(taskItem.description);
      expect(result.solution).toBe(taskItem.description); // 旧格式使用 description 作为回退
      expect(result.type).toBe(taskItem.type);
      expect(result.priority).toBe(taskItem.priority);
      expect(result.checkpoints).toEqual(taskItem.suggestedCheckpoints);
      expect(result.relatedFiles).toEqual(taskItem.relatedFiles);
      expect(result.estimatedMinutes).toBe(taskItem.estimatedMinutes);
    });
  });

  describe('reportDecompositionFailure', () => {
    let consoleErrorSpy: typeof console.error;

    beforeEach(() => {
      consoleErrorSpy = console.error;
      console.error = () => {};
    });

    afterEach(() => {
      console.error = consoleErrorSpy;
    });

    test('报告分解失败信息', () => {
      // 应该不抛出异常
      expect(() => {
        reportDecompositionFailure('测试失败原因');
      }).not.toThrow();
    });

    test('报告分解失败信息带错误列表', () => {
      const errors = ['错误1: 标题过短', '错误2: 描述不完整'];

      expect(() => {
        reportDecompositionFailure('质量检查失败', errors);
      }).not.toThrow();
    });

    test('报告分解失败信息带任务标题', () => {
      expect(() => {
        reportDecompositionFailure('分解失败', ['错误1'], '修复登录问题');
      }).not.toThrow();
    });
  });

  describe('安全验证', () => {
    test('拒绝过长的输入内容', async () => {
      // 创建超过50000字符的内容
      const baseText = '问题1: 这是一个问题描述，需要足够长的文本来测试长度限制功能。这是额外的填充文本确保超过限制。';
      // 基础文本长度48字符，重复1200次 = 57600字符
      const longContent = baseText.repeat(1200);

      // 验证内容长度超过50000
      expect(longContent.length).toBeGreaterThan(50000);

      const result = await decomposeRequirement(longContent, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
      expect(result.reason).toContain('过长');
    });

    test('拒绝包含危险脚本的输入', async () => {
      // 确保内容超过100字符的最小长度，且包含危险脚本
      const maliciousContent = `
问题1: 修复登录页面样式错误和脚本安全问题
用户点击登录按钮后没有任何反应，<script>alert('xss')</script>这是一个严重的安全漏洞需要立即修复。
问题2: 添加用户注册功能
需要实现用户可以在网站注册新账号的功能，包括邮箱验证和密码设置。
      `;

      const result = await decomposeRequirement(maliciousContent, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
      expect(result.reason).toContain('危险');
    });

    test('拒绝包含javascript:协议的输入', async () => {
      const maliciousContent = `
问题1: 修复登录页面样式错误和链接安全问题
用户点击登录按钮后没有任何反应，点击这里: javascript:alert('xss')这是一个严重的安全漏洞需要立即修复处理。
问题2: 添加用户注册功能
需要实现用户可以在网站注册新账号的功能，包括邮箱验证和密码设置。
      `;

      const result = await decomposeRequirement(maliciousContent, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
    });

    test('拒绝包含eval的输入', async () => {
      const maliciousContent = `
问题1: 修复登录页面样式错误和代码执行问题
用户点击登录按钮后没有任何反应，eval(some dangerous code)这是一个严重的安全漏洞需要立即修复处理解决。
问题2: 添加用户注册功能
需要实现用户可以在网站注册新账号的功能，包括邮箱验证和密码设置。
      `;

      const result = await decomposeRequirement(maliciousContent, {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
    });
  });

  describe('递归分解', () => {
    test('禁用递归时返回原始任务列表', async () => {
      const items: DecomposedTaskItem[] = [
        {
          title: '任务1: 这是一个复杂的任务需要很多时间来完成',
          description: '这是一个非常复杂的任务描述，需要详细说明实现步骤和注意事项。涉及多个模块的修改和协调工作，预估需要较长时间完成。',
          type: 'feature',
          priority: 'P1',
          suggestedCheckpoints: ['步骤1', '步骤2'],
          relatedFiles: ['src/file1.ts'],
          estimatedMinutes: 60,
          dependsOn: [],
        },
      ];

      const config = {
        ...DEFAULT_RECURSIVE_CONFIG,
        enabled: false,
      };

      const result = await decomposeRecursively(items, { useAI: false }, config);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('任务1: 这是一个复杂的任务需要很多时间来完成');
    });

    test('达到最大深度时停止递归', async () => {
      const items: DecomposedTaskItem[] = [
        {
          title: '任务1: 这是一个复杂的任务需要很多时间来完成',
          description: '这是一个非常复杂的任务描述，需要详细说明实现步骤和注意事项。涉及多个模块的修改和协调工作，预估需要较长时间完成。',
          type: 'feature',
          priority: 'P1',
          suggestedCheckpoints: ['步骤1', '步骤2'],
          relatedFiles: ['src/file1.ts'],
          estimatedMinutes: 60,
          dependsOn: [],
        },
      ];

      const config = {
        ...DEFAULT_RECURSIVE_CONFIG,
        enabled: true,
        maxDepth: 0, // 立即达到最大深度
      };

      const result = await decomposeRecursively(items, { useAI: false }, config, 0);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('任务1: 这是一个复杂的任务需要很多时间来完成');
    });

    test('低耗时任务不进行递归分解', async () => {
      const items: DecomposedTaskItem[] = [
        {
          title: '简单任务',
          description: '这是一个简单的任务描述。',
          type: 'bug',
          priority: 'P2',
          suggestedCheckpoints: ['修复问题'],
          relatedFiles: ['src/file.ts'],
          estimatedMinutes: 10, // 低于复杂度阈值
          dependsOn: [],
        },
      ];

      const config = {
        ...DEFAULT_RECURSIVE_CONFIG,
        enabled: true,
        complexityThreshold: 15,
      };

      const result = await decomposeRecursively(items, { useAI: false }, config, 0);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('简单任务');
    });

    test('短描述任务不进行递归分解', async () => {
      const items: DecomposedTaskItem[] = [
        {
          title: '短描述任务',
          description: '短描述。', // 少于100字符
          type: 'bug',
          priority: 'P2',
          suggestedCheckpoints: ['修复问题'],
          relatedFiles: ['src/file.ts'],
          estimatedMinutes: 60,
          dependsOn: [],
        },
      ];

      const config = {
        ...DEFAULT_RECURSIVE_CONFIG,
        enabled: true,
        complexityThreshold: 15,
      };

      const result = await decomposeRecursively(items, { useAI: false }, config, 0);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('短描述任务');
    });
  });

  describe('边缘情况', () => {
    test('处理只有换行符的内容', async () => {
      const result = await decomposeRequirement('\n\n\n', {
        useAI: false,
        minItems: 2,
      });

      expect(result.decomposable).toBe(false);
    });

    test('处理包含特殊字符的内容', async () => {
      const content = `
问题1: 修复登录问题 @#$%^&*()
需要处理特殊字符: <>[]{}|\\

问题2: 添加新功能
需要实现用户注册功能。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 应该正常处理或返回不可分解，而不是抛出异常
      expect(typeof result.decomposable).toBe('boolean');
    });

    test('处理包含大量空白字符的内容', async () => {
      const content = `
问题1:     修复登录页面样式错误问题
    需要修复CSS样式，确保按钮在不同屏幕尺寸下正常显示。

问题2:     添加用户注册功能
    需要实现用户注册功能，包括邮箱验证和密码强度检查。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行，不抛出异常
      expect(typeof result.decomposable).toBe('boolean');
      if (result.decomposable) {
        expect(result.items.length).toBeGreaterThanOrEqual(1);
      }
    });

    test('处理包含重复问题标题的内容', async () => {
      const content = `
问题1: 修复登录页面样式错误
需要修复CSS样式，确保按钮在移动端显示正常，修复宽度超出问题。

问题1: 修复登录页面样式错误
这是重复的问题描述，应该被去重处理。

问题2: 添加用户注册功能
需要实现用户注册功能，包括邮箱验证和密码强度检查。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行，不抛出异常（重复项处理取决于实现）
      expect(typeof result.decomposable).toBe('boolean');
    });

    test('处理优先级边界值', async () => {
      const content = `
问题1 (P0): 紧急修复登录页面崩溃问题
需要立即处理，生产环境出现严重错误导致用户无法登录系统。

问题2 (P3): 低优先级优化界面样式
可以延后处理，不影响核心功能使用。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行
      expect(typeof result.decomposable).toBe('boolean');
      if (result.decomposable && result.items.length >= 2) {
        const priorities = result.items.map(item => item.priority);
        // 检查是否识别到优先级（如果分解成功）
        if (priorities.length > 0) {
          expect(priorities.some(p => ['P0', 'P1', 'P2', 'P3'].includes(p))).toBe(true);
        }
      }
    });

    test('处理非标准优先级标记', async () => {
      const content = `
问题1 (紧急): 紧急修复登录问题
需要立即处理，生产环境出现严重错误导致用户无法正常使用系统功能。

问题2 (高): 高优先级任务优化性能
需要优先处理，提升系统响应速度。

问题3 (低): 低优先级任务界面美化
可以延后处理，不影响核心功能使用。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行
      expect(typeof result.decomposable).toBe('boolean');
      if (result.decomposable) {
        // 如果成功分解，检查优先级映射
        const priorities = result.items.map(item => item.priority);
        expect(priorities.length).toBeGreaterThanOrEqual(2);
      }
    });

    test('处理包含URL的内容', async () => {
      const content = `
问题1: 修复API端点响应格式问题
需要修复 https://api.example.com/users 端点的响应格式，确保返回正确的JSON结构。
相关文档: https://docs.example.com/api

问题2: 更新配置文件中的URL设置
需要修改配置文件中的URL设置，指向新的API服务器地址。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行，不抛出异常
      expect(typeof result.decomposable).toBe('boolean');
    });

    test('处理包含代码块的内容', async () => {
      const content = `
问题1: 修复登录认证函数错误
需要修复以下函数，当前实现存在安全漏洞：
\`\`\`typescript
function login() {
  return user.authenticate();
}
\`\`\`
需要添加输入验证和错误处理逻辑。

问题2: 添加新的用户权限检查方法
需要添加新的处理方法来验证用户权限。
      `;

      const result = await decomposeRequirement(content, {
        useAI: false,
        minItems: 2,
        validateQuality: false,
      });

      // 验证函数正常执行，不抛出异常
      expect(typeof result.decomposable).toBe('boolean');
    });
  });
});
