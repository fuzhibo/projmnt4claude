/**
 * Code Ready Checker Tests
 * 代码就绪检查器测试
 *
 * 测试内容:
 * - CP-1: 代码文件存在检查
 * - CP-2: 语法有效性检查
 * - CP-3: 构建可执行性检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import {
  CodeReadyChecker,
  createCodeReadyChecker,
  quickCodeReadyCheck,
  batchCodeReadyCheck,
  formatCodeReadyResult,
  DEFAULT_CODE_READY_CHECKER_CONFIG,
} from '../utils/pre-cr-gate/checkers/code-ready-checker.js';
import type { TaskMeta } from '../types/task.js';
import {
  createIsolatedTestEnv,
  createTaskDir,
  writeTaskMeta,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ============== 测试套件 ==============

describe('CodeReadyChecker', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ prefix: 'code-ready-test-' });
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('CP-1: 代码文件存在检查', () => {
    it('当所有文件存在时应该通过', async () => {
      // Arrange
      const taskId = 'TASK-test-001';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['src/test.ts'],
      });

      const codeFile = path.join(env.tempDir, 'src', 'test.ts');
      mkdirSync(path.dirname(codeFile), { recursive: true });
      writeFileSync(codeFile, 'console.log("test");');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const fileCheck = result.checks.find(c => c.checkId === 'file-existence');
      expect(fileCheck?.passed).toBe(true);
      expect(fileCheck?.message).toContain('所有代码文件已存在');
    });

    it('当文件不存在时应该失败', async () => {
      // Arrange
      const taskId = 'TASK-test-002';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['src/non-existent.ts'],
      });

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const fileCheck = result.checks.find(c => c.checkId === 'file-existence');
      expect(fileCheck?.passed).toBe(false);
      expect(fileCheck?.message).toContain('缺少代码文件');
    });

    it('当没有配置文件时应该跳过', async () => {
      // Arrange
      const taskId = 'TASK-test-003';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
      });

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const fileCheck = result.checks.find(c => c.checkId === 'file-existence');
      expect(fileCheck?.passed).toBe(true);
      expect(fileCheck?.message).toContain('跳过存在性检查');
    });

    it('应该同时检查 affected_files 和 files', async () => {
      // Arrange
      const taskId = 'TASK-test-004';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['src/file1.ts'],
        files: ['src/file2.ts'],
      });

      const file1 = path.join(env.tempDir, 'src', 'file1.ts');
      const file2 = path.join(env.tempDir, 'src', 'file2.ts');
      mkdirSync(path.dirname(file1), { recursive: true });
      writeFileSync(file1, 'console.log("file1");');
      writeFileSync(file2, 'console.log("file2");');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const fileCheck = result.checks.find(c => c.checkId === 'file-existence');
      expect(fileCheck?.passed).toBe(true);
      expect(fileCheck?.details?.totalFiles).toBe(2);
    });
  });

  describe('CP-2: 语法有效性检查', () => {
    it('当 JSON 文件语法有效时应该通过', async () => {
      // Arrange
      const taskId = 'TASK-test-101';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['config.json'],
      });

      const jsonFile = path.join(env.tempDir, 'config.json');
      writeFileSync(jsonFile, '{"key": "value", "number": 123}');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const syntaxCheck = result.checks.find(c => c.checkId === 'syntax-validity');
      expect(syntaxCheck?.passed).toBe(true);
      expect(syntaxCheck?.details?.validFiles).toContain('config.json');
    });

    it('当 JSON 文件语法无效时应该失败', async () => {
      // Arrange
      const taskId = 'TASK-test-102';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['invalid.json'],
      });

      const jsonFile = path.join(env.tempDir, 'invalid.json');
      writeFileSync(jsonFile, '{"key": "value", invalid}');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const syntaxCheck = result.checks.find(c => c.checkId === 'syntax-validity');
      expect(syntaxCheck?.passed).toBe(false);
    });

    it('当 JavaScript 文件语法有效时应该通过', async () => {
      // Arrange
      const taskId = 'TASK-test-103';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['script.js'],
      });

      const jsFile = path.join(env.tempDir, 'script.js');
      writeFileSync(jsFile, 'const x = 1;\nfunction test() { return x + 1; }\nmodule.exports = test;');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const syntaxCheck = result.checks.find(c => c.checkId === 'syntax-validity');
      expect(syntaxCheck?.passed).toBe(true);
    });

    it('当 Markdown 文件不为空时应该通过', async () => {
      // Arrange
      const taskId = 'TASK-test-104';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['README.md'],
      });

      const mdFile = path.join(env.tempDir, 'README.md');
      writeFileSync(mdFile, '# Test\n\nThis is a test file.');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const syntaxCheck = result.checks.find(c => c.checkId === 'syntax-validity');
      expect(syntaxCheck?.passed).toBe(true);
    });

    it('当没有需要检查语法的文件时应该跳过', async () => {
      // Arrange
      const taskId = 'TASK-test-105';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['file.txt'],
      });

      const txtFile = path.join(env.tempDir, 'file.txt');
      writeFileSync(txtFile, 'plain text content');

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const syntaxCheck = result.checks.find(c => c.checkId === 'syntax-validity');
      expect(syntaxCheck?.passed).toBe(true);
      expect(syntaxCheck?.message).toContain('没有需要检查语法的文件');
    });
  });

  describe('CP-3: 构建可执行性检查', () => {
    it('当没有构建配置时应该跳过', async () => {
      // Arrange
      const taskId = 'TASK-test-201';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
      });

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const buildCheck = result.checks.find(c => c.checkId === 'buildability');
      expect(buildCheck?.passed).toBe(true);
      expect(buildCheck?.message).toContain('未找到构建配置');
    });

    it('当 package.json 存在但没有 build 脚本时应该跳过', async () => {
      // Arrange
      const taskId = 'TASK-test-202';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
      });

      const packageJson = path.join(env.tempDir, 'package.json');
      writeFileSync(packageJson, JSON.stringify({
        name: 'test',
        version: '1.0.0',
        scripts: { test: 'echo test' },
      }, null, 2));

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const buildCheck = result.checks.find(c => c.checkId === 'buildability');
      expect(buildCheck?.passed).toBe(true);
      expect(buildCheck?.message).toContain('没有配置 build 脚本');
    });
  });

  describe('其他检查', () => {
    it('应该检查变更大小', async () => {
      // Arrange
      const taskId = 'TASK-test-301';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['src/large.ts'],
      });

      const codeFile = path.join(env.tempDir, 'src', 'large.ts');
      mkdirSync(path.dirname(codeFile), { recursive: true });
      writeFileSync(codeFile, 'console.log("test");\n'.repeat(10));

      const checker = new CodeReadyChecker(env.tempDir, { maxChangeLines: 100 });

      // Act
      const result = await checker.check(taskId);

      // Assert
      const sizeCheck = result.checks.find(c => c.checkId === 'change-size');
      expect(sizeCheck?.passed).toBe(true);
      expect(sizeCheck?.details?.totalLines).toBeGreaterThanOrEqual(10);
    });

    it('当变更行数超过限制时应该警告', async () => {
      // Arrange
      const taskId = 'TASK-test-302';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['src/huge.ts'],
      });

      const codeFile = path.join(env.tempDir, 'src', 'huge.ts');
      mkdirSync(path.dirname(codeFile), { recursive: true });
      writeFileSync(codeFile, 'console.log("test");\n'.repeat(200));

      const checker = new CodeReadyChecker(env.tempDir, { maxChangeLines: 100 });

      // Act
      const result = await checker.check(taskId);

      // Assert
      const sizeCheck = result.checks.find(c => c.checkId === 'change-size');
      expect(sizeCheck?.passed).toBe(false);
      expect(sizeCheck?.message).toContain('变更行数过多');
    });

    it('应该检测二进制文件', async () => {
      // Arrange
      const taskId = 'TASK-test-303';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['file.exe', 'data.bin'],
      });

      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check(taskId);

      // Assert
      const binaryCheck = result.checks.find(c => c.checkId === 'binary-files');
      expect(binaryCheck?.passed).toBe(false);
      expect(binaryCheck?.details?.binaryFiles).toContain('file.exe');
      expect(binaryCheck?.details?.binaryFiles).toContain('data.bin');
    });
  });

  describe('配置和工具函数', () => {
    it('createCodeReadyChecker 应该创建检查器实例', () => {
      const checker = createCodeReadyChecker(env.tempDir, { maxChangeLines: 100 });
      expect(checker).toBeInstanceOf(CodeReadyChecker);
      expect(checker.getConfig().maxChangeLines).toBe(100);
    });

    it('updateConfig 应该更新配置', () => {
      const checker = new CodeReadyChecker(env.tempDir);
      checker.updateConfig({ maxChangeLines: 200 });
      expect(checker.getConfig().maxChangeLines).toBe(200);
    });

    it('当检查禁用时应该直接返回通过', async () => {
      // Arrange
      const taskId = 'TASK-test-401';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
      });

      const checker = new CodeReadyChecker(env.tempDir, { enabled: false });

      // Act
      const result = await checker.check(taskId);

      // Assert
      expect(result.allPassed).toBe(true);
      expect(result.checks[0].checkId).toBe('disabled');
    });

    it('当任务不存在时应该返回失败', async () => {
      // Arrange
      const checker = new CodeReadyChecker(env.tempDir);

      // Act
      const result = await checker.check('NON-EXISTENT-TASK');

      // Assert
      expect(result.allPassed).toBe(false);
      expect(result.checks[0].checkId).toBe('task-existence');
    });
  });

  describe('批量检查', () => {
    it('batchCodeReadyCheck 应该批量执行检查', async () => {
      // Arrange
      const taskId1 = 'TASK-test-batch-001';
      const taskId2 = 'TASK-test-batch-002';
      createTaskDir(env.tasksDir, taskId1, {
        id: taskId1,
        title: 'Test Task 1',
        status: 'in_progress',
        affected_files: ['src1.ts'],
      });
      createTaskDir(env.tasksDir, taskId2, {
        id: taskId2,
        title: 'Test Task 2',
        status: 'in_progress',
        affected_files: ['src2.ts'],
      });

      const file1 = path.join(env.tempDir, 'src1.ts');
      const file2 = path.join(env.tempDir, 'src2.ts');
      writeFileSync(file1, 'console.log("1");');
      writeFileSync(file2, 'console.log("2");');

      // Act
      const results = await batchCodeReadyCheck([taskId1, taskId2], env.tempDir);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].taskId).toBe(taskId1);
      expect(results[1].taskId).toBe(taskId2);
    });

    it('quickCodeReadyCheck 应该快速执行检查', async () => {
      // Arrange
      const taskId = 'TASK-test-quick-001';
      createTaskDir(env.tasksDir, taskId, {
        id: taskId,
        title: 'Test Task',
        status: 'in_progress',
        affected_files: ['test.ts'],
      });

      const codeFile = path.join(env.tempDir, 'test.ts');
      writeFileSync(codeFile, 'console.log("test");');

      // Act
      const result = await quickCodeReadyCheck(taskId, env.tempDir);

      // Assert
      expect(result.taskId).toBe(taskId);
      expect(result.checks.length).toBeGreaterThan(0);
    });
  });

  describe('结果格式化', () => {
    it('formatCodeReadyResult 应该格式化结果', () => {
      // Arrange
      const result = {
        taskId: 'TASK-test',
        allPassed: true,
        checks: [
          {
            checkId: 'test-check',
            name: 'Test Check',
            passed: true,
            message: 'Test message',
            duration: 100,
            timestamp: new Date().toISOString(),
          },
        ],
        passedCount: 1,
        failedCount: 0,
        duration: 100,
        timestamp: new Date().toISOString(),
      };

      // Act
      const formatted = formatCodeReadyResult(result);

      // Assert
      expect(formatted).toContain('代码就绪检查');
      expect(formatted).toContain('TASK-test');
      expect(formatted).toContain('通过');
      expect(formatted).toContain('Test Check');
    });

    it('formatCodeReadyResult 应该显示失败状态', () => {
      // Arrange
      const result = {
        taskId: 'TASK-test',
        allPassed: false,
        checks: [
          {
            checkId: 'test-check',
            name: 'Test Check',
            passed: false,
            message: 'Test failed',
            duration: 100,
            timestamp: new Date().toISOString(),
          },
        ],
        passedCount: 0,
        failedCount: 1,
        duration: 100,
        timestamp: new Date().toISOString(),
      };

      // Act
      const formatted = formatCodeReadyResult(result);

      // Assert
      expect(formatted).toContain('❌');
      expect(formatted).toContain('失败');
    });
  });
});

describe('DEFAULT_CODE_READY_CHECKER_CONFIG', () => {
  it('应该包含正确的默认值', () => {
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.checkFileExistence).toBe(true);
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.checkSyntaxValidity).toBe(true);
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.checkBuildability).toBe(true);
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.maxChangeLines).toBe(500);
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.syntaxCheckExtensions).toContain('.ts');
    expect(DEFAULT_CODE_READY_CHECKER_CONFIG.syntaxCheckExtensions).toContain('.tsx');
  });

  it('getSyntaxCheckCommand 应该返回正确的命令', () => {
    const config = DEFAULT_CODE_READY_CHECKER_CONFIG;

    expect(config.getSyntaxCheckCommand('test.ts')).toContain('tsc');
    expect(config.getSyntaxCheckCommand('test.tsx')).toContain('tsc');
    expect(config.getSyntaxCheckCommand('test.js')).toContain('eslint');
    expect(config.getSyntaxCheckCommand('test.json')).toContain('JSON.parse');
    expect(config.getSyntaxCheckCommand('test.txt')).toBeNull();
  });
});
