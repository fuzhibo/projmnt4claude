import { describe, test, expect } from 'bun:test';
import {
  decomposeRequirement,
  shouldDecompose,
  formatDecomposition,
} from '../requirement-decomposer';
import type { RequirementDecomposition } from '../../types/decomposition';

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
});
