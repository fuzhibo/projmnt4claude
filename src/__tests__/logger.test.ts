/**
 * logger.ts 单元测试
 *
 * 测试重点:
 * - Logger 基本日志功能 (info, error, warn, debug)
 * - 组件标记和子 logger
 * - 命令日志记录
 * - 日志级别过滤
 * - AI 成本日志
 * - Bug 报告生成
 * - 日志清理
 * - 成本汇总
 * - 使用分析
 * - createLogger 工厂函数
 * - 日志持久化
 *
 * 迁移说明:
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 * - 使用 spyOn 替代直接修改 console 全局对象
 * - 确保测试隔离，防止跨测试污染
 */

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, createLogger, type LogLevel, type AICostSummary, type InstrumentationRecord } from '../utils/logger';
import { getLogsDir } from '../utils/path';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

describe('Logger', () => {
  let env: IsolatedTestEnv;
  let testCwd: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
    testCwd = env.tempDir;

    // 创建测试目录
    if (!fs.existsSync(testCwd)) {
      fs.mkdirSync(testCwd, { recursive: true });
    }

    // 使用 spyOn 监听 console 方法，而不是直接替换
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    // 恢复所有 spy
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();

    // 清理测试环境
    await env.cleanup();
  });

  describe('Basic Logging', () => {
    test('should log info message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.info('Test info message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should log error message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.error('Test error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should log warn message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.warn('Test warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test('should log debug message when level is debug', () => {
      const originalLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'debug';
      try {
        const logger = new Logger({ cwd: testCwd });
        logger.debug('Test debug message');
        expect(consoleLogSpy).toHaveBeenCalled();
      } finally {
        // Reset environment
        if (originalLevel) {
          process.env.LOG_LEVEL = originalLevel;
        } else {
          delete process.env.LOG_LEVEL;
        }
      }
    });

    test('should include data in log output', () => {
      const logger = new Logger({ cwd: testCwd });
      const testData = { key: 'value', count: 42 };
      logger.info('Test with data', testData);
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Component Labeling', () => {
    test('should create child logger with component', () => {
      const logger = new Logger({ cwd: testCwd, component: 'parent' });
      const childLogger = logger.child('child');

      childLogger.info('Child message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should create nested child loggers', () => {
      const logger = new Logger({ cwd: testCwd, component: 'root' });
      const child1 = logger.child('level1');
      const child2 = child1.child('level2');

      child2.info('Nested message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should prefix logs with component name', () => {
      const logger = new Logger({ cwd: testCwd, component: 'TestComponent' });
      logger.info('Component message');

      const calls = consoleLogSpy.mock.calls as string[][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toContain('[TestComponent]');
    });
  });

  describe('Command Logging', () => {
    test('should log command start', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.logCommandStart('test-command', { arg1: 'value1' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls as string[][];
      expect(calls[0][0]).toContain('test-command');
    });

    test('should log command end', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.logCommandStart('test-command');
      logger.logCommandEnd('test-command', 0);

      const calls = consoleLogSpy.mock.calls as string[][];
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toContain('test-command');
    });

    test('should write logs to file when command is set', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test-cmd' });
      logger.info('File log message');
      logger.flush();

      const logsDir = getLogsDir(testCwd);
      const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('Log Levels', () => {
    test('should respect LOG_LEVEL environment variable', () => {
      const originalLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'error';

      try {
        const logger = new Logger({ cwd: testCwd });
        logger.info('This should not appear');
        logger.error('This should appear');

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
      } finally {
        // Reset environment
        if (originalLevel) {
          process.env.LOG_LEVEL = originalLevel;
        } else {
          delete process.env.LOG_LEVEL;
        }
      }
    });

    test('should filter by log level', () => {
      const logger = new Logger({ cwd: testCwd });

      // At default 'info' level, debug should not be logged
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('AI Cost Logging', () => {
    test('should log AI cost summary', () => {
      const logger = new Logger({ cwd: testCwd });
      const costSummary: AICostSummary = {
        field: 'test-field',
        durationMs: 1500,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      logger.logAICost(costSummary);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should log instrumentation record', () => {
      const logger = new Logger({ cwd: testCwd });
      const record: InstrumentationRecord = {
        module: 'test-module',
        action: 'test-action',
        input_summary: 'test input',
        output_summary: 'test output',
        ai_used: true,
        ai_enhanced_fields: ['field1', 'field2'],
        duration_ms: 2000,
        user_edit_count: 5,
      };

      logger.logInstrumentation(record);
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Bug Report Generation', () => {
    test('should generate bug report', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test' });
      logger.error('Test error 1');
      logger.error('Test error 2');
      logger.warn('Test warning');
      logger.flush();

      const report = logger.generateBugReport(50);

      expect(report.markdown).toContain('Bug Report');
      expect(report.markdown).toContain('Test error 1');
      expect(report.markdown).toContain('Test error 2');
      expect(report.archivePath).toBeTruthy();
    });

    test('should create archive file', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test' });
      logger.error('Test error');
      logger.flush();

      const report = logger.generateBugReport(50);

      expect(fs.existsSync(report.archivePath)).toBe(true);
    });
  });

  describe('Log Cleanup', () => {
    test('should clean up old log files', () => {
      const logsDir = path.join(testCwd, '.projmnt4claude', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });

      // Create an old log file
      const oldLogFile = path.join(logsDir, 'test-20200101.log');
      fs.writeFileSync(oldLogFile, 'old log content');

      // Set file mtime to be very old
      const oldDate = new Date('2020-01-01');
      fs.utimesSync(oldLogFile, oldDate, oldDate);

      const logger = new Logger({ cwd: testCwd });
      const deletedCount = logger.cleanupOldLogs(30);

      expect(deletedCount).toBe(1);
      expect(fs.existsSync(oldLogFile)).toBe(false);
    });

    test('should not delete recent log files', () => {
      const logsDir = path.join(testCwd, '.projmnt4claude', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });

      // Create a recent log file
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
      const recentLogFile = path.join(logsDir, `test-${dateStr}.log`);
      fs.writeFileSync(recentLogFile, 'recent log content');

      const logger = new Logger({ cwd: testCwd });
      const deletedCount = logger.cleanupOldLogs(30);

      expect(deletedCount).toBe(0);
      expect(fs.existsSync(recentLogFile)).toBe(true);
    });
  });

  describe('Cost Summary', () => {
    test('should return cost summary with zero values when no AI logs', () => {
      const logger = new Logger({ cwd: testCwd });
      const summary = logger.getCostSummary();

      expect(summary.totalCalls).toBe(0);
      expect(summary.totalDurationMs).toBe(0);
      expect(summary.totalTokens).toBe(0);
      expect(Object.keys(summary.byField)).toHaveLength(0);
    });

    test('should aggregate AI cost data', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test' });

      const cost1: AICostSummary = {
        field: 'field1',
        durationMs: 1000,
        inputTokens: 50,
        outputTokens: 25,
        totalTokens: 75,
      };

      const cost2: AICostSummary = {
        field: 'field2',
        durationMs: 2000,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      logger.logAICost(cost1);
      logger.logAICost(cost2);
      logger.flush();

      const summary = logger.getCostSummary();

      expect(summary.totalCalls).toBe(2);
      expect(summary.totalDurationMs).toBe(3000);
      expect(summary.totalTokens).toBe(225);
    });
  });

  describe('Usage Analysis', () => {
    test('should return usage analysis', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test' });

      logger.logCommandStart('cmd1');
      logger.logCommandEnd('cmd1', 0);
      logger.logCommandStart('cmd2');
      logger.logCommandEnd('cmd2', 0);
      logger.error('Test error');
      logger.warn('Test warning');
      logger.flush();

      const analysis = logger.analyzeUsage();

      expect(analysis.totalCommands).toBeGreaterThanOrEqual(2);
      expect(analysis.totalErrors).toBeGreaterThanOrEqual(1);
      expect(analysis.totalWarnings).toBeGreaterThanOrEqual(1);
    });

    test('should track command frequency', () => {
      const logger = new Logger({ cwd: testCwd, command: 'test' });

      logger.logCommandStart('popular-cmd');
      logger.logCommandEnd('popular-cmd', 0);
      logger.logCommandStart('popular-cmd');
      logger.logCommandEnd('popular-cmd', 0);
      logger.flush();

      const analysis = logger.analyzeUsage();

      expect(Object.keys(analysis.commandFrequency)).toContain('popular-cmd');
    });
  });

  describe('createLogger factory', () => {
    test('should create logger with command and log start', () => {
      const logger = createLogger('factory-test', testCwd);
      logger.logCommandEnd('factory-test', 0);
      logger.flush();

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Flush and Persistence', () => {
    test('should flush buffer to file', () => {
      const logger = new Logger({ cwd: testCwd, command: 'flush-test' });
      logger.info('Before flush');
      logger.flush();

      const logsDir = getLogsDir(testCwd);
      const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
      expect(files.length).toBeGreaterThan(0);

      // Read and verify content
      const logFile = path.join(logsDir, files[0]);
      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('Before flush');
    });

    test('should handle multiple log entries', () => {
      const logger = new Logger({ cwd: testCwd, command: 'multi-test' });

      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`);
      }
      logger.flush();

      const logsDir = getLogsDir(testCwd);
      const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
      const logFile = path.join(logsDir, files[0]);
      const content = fs.readFileSync(logFile, 'utf-8');

      // Should have 5 JSON lines plus command start
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(5);
    });
  });
});
