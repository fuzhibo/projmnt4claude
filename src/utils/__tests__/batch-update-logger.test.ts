/**
 * Batch Update Logger 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectOperationSource,
  getExecutionContext,
  getBatchUpdateLogPath,
  writeBatchUpdateLog,
  readBatchUpdateLogs,
  formatLogEntry,
  queryBatchUpdateLogs,
  formatLogList,
  showLogSummary,
  type BatchUpdateLogEntry,
} from '../batch-update-logger';

const TEST_DIR = path.join(process.cwd(), '.test-batch-logger');
const TEST_LOGS_DIR = path.join(TEST_DIR, '.projmnt4claude', 'logs');

describe('Batch Update Logger', () => {
  beforeEach(() => {
    // 创建测试目录
    if (!fs.existsSync(TEST_LOGS_DIR)) {
      fs.mkdirSync(TEST_LOGS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('detectOperationSource', () => {
    it('应该检测 CLI 环境', () => {
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = true;

      const source = detectOperationSource();
      expect(['cli', 'unknown']).toContain(source);

      process.stdin.isTTY = originalIsTTY;
    });

    it('应该检测 IDE 环境 (VSCode)', () => {
      const originalVscodePid = process.env.VSCODE_PID;
      process.env.VSCODE_PID = '12345';

      const source = detectOperationSource();
      expect(source).toBe('ide');

      if (originalVscodePid !== undefined) {
        process.env.VSCODE_PID = originalVscodePid;
      } else {
        delete process.env.VSCODE_PID;
      }
    });

    it('应该检测 Hook 环境', () => {
      const originalHookMode = process.env.PROJMNT4CLAUDE_HOOK_MODE;
      process.env.PROJMNT4CLAUDE_HOOK_MODE = 'true';

      const source = detectOperationSource();
      expect(source).toBe('hook');

      if (originalHookMode !== undefined) {
        process.env.PROJMNT4CLAUDE_HOOK_MODE = originalHookMode;
      } else {
        delete process.env.PROJMNT4CLAUDE_HOOK_MODE;
      }
    });
  });

  describe('getExecutionContext', () => {
    it('应该返回执行上下文信息', () => {
      const context = getExecutionContext(TEST_DIR);

      expect(context).toHaveProperty('cwd');
      expect(context).toHaveProperty('pid');
      expect(context).toHaveProperty('ppid');
      expect(context).toHaveProperty('envIndicators');
      expect(context).toHaveProperty('callStack');
      expect(context).toHaveProperty('processUptime');
      expect(context).toHaveProperty('fullCommand');

      expect(context.cwd).toBe(TEST_DIR);
      expect(typeof context.pid).toBe('number');
      expect(typeof context.ppid).toBe('number');
    });

    it('应该包含环境指示器', () => {
      const context = getExecutionContext(TEST_DIR);

      expect(context.envIndicators).toHaveProperty('isVscode');
      expect(context.envIndicators).toHaveProperty('isCursor');
      expect(context.envIndicators).toHaveProperty('isJetbrains');
      expect(context.envIndicators).toHaveProperty('isTmux');
      expect(context.envIndicators).toHaveProperty('isCi');

      expect(typeof context.envIndicators.isVscode).toBe('boolean');
    });
  });

  describe('getBatchUpdateLogPath', () => {
    it('应该返回正确的日志文件路径', () => {
      const logPath = getBatchUpdateLogPath(TEST_DIR);
      const today = new Date().toISOString().split('T')[0];

      expect(logPath).toContain(`batch-update-${today}.log`);
      expect(logPath).toContain('.projmnt4claude/logs');
    });
  });

  describe('writeBatchUpdateLog & readBatchUpdateLogs', () => {
    it('应该写入并读取日志条目', () => {
      const entry = {
        commandArgs: ['task', 'batch-update', '--status', 'open'],
        options: {
          status: 'open',
          all: false,
          yes: false,
        },
        tasks: [
          {
            id: 'TASK-001',
            title: '测试任务',
            oldStatus: 'resolved',
            newStatus: 'open',
          },
        ],
        summary: {
          totalCount: 1,
          updatedCount: 1,
          filteredCount: 0,
        },
      };

      writeBatchUpdateLog(entry, TEST_DIR);

      const logs = readBatchUpdateLogs(undefined, TEST_DIR);
      expect(logs.length).toBeGreaterThan(0);

      const lastLog = logs[logs.length - 1];
      expect(lastLog).toHaveProperty('timestamp');
      expect(lastLog).toHaveProperty('source');
      expect(lastLog).toHaveProperty('context');
      expect(lastLog.commandArgs).toEqual(entry.commandArgs);
      expect(lastLog.tasks).toHaveLength(1);
      expect(lastLog.tasks[0].id).toBe('TASK-001');
    });

    it('应该按日期读取日志', () => {
      const today = new Date().toISOString().split('T')[0];
      const logs = readBatchUpdateLogs(today, TEST_DIR);

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('formatLogEntry', () => {
    it('应该格式化日志条目为可读文本', () => {
      const entry: BatchUpdateLogEntry = {
        timestamp: '2026-04-15T07:31:59.173Z',
        source: 'cli',
        commandArgs: ['task', 'batch-update', '--status', 'open'],
        options: {
          status: 'open',
        },
        tasks: [
          {
            id: 'TASK-001',
            title: '测试任务',
            oldStatus: 'resolved',
            newStatus: 'open',
          },
        ],
        summary: {
          totalCount: 1,
          updatedCount: 1,
          filteredCount: 0,
        },
        context: {
          cwd: TEST_DIR,
          pid: 12345,
          ppid: 12344,
          envIndicators: {
            isVscode: false,
            isCursor: false,
            isJetbrains: false,
            isTmux: false,
            isCi: false,
          },
        },
      };

      const formatted = formatLogEntry(entry);

      expect(formatted).toContain('Batch Update Operation');
      expect(formatted).toContain('Source: cli');
      expect(formatted).toContain('TASK-001');
      expect(formatted).toContain('resolved → open');
    });
  });

  describe('queryBatchUpdateLogs', () => {
    it('应该支持按来源过滤', () => {
      const logs = queryBatchUpdateLogs({ source: 'cli' }, TEST_DIR);
      expect(Array.isArray(logs)).toBe(true);
    });

    it('应该支持按时间范围过滤', () => {
      const startTime = new Date('2026-01-01');
      const endTime = new Date('2026-12-31');

      const logs = queryBatchUpdateLogs(
        { startTime, endTime },
        TEST_DIR
      );
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('formatLogList', () => {
    it('应该格式化日志列表', () => {
      const entries: BatchUpdateLogEntry[] = [
        {
          timestamp: '2026-04-15T07:31:59.173Z',
          source: 'cli',
          commandArgs: ['task', 'batch-update'],
          options: {},
          tasks: [],
          summary: {
            totalCount: 1,
            updatedCount: 1,
            filteredCount: 0,
          },
          context: {
            cwd: TEST_DIR,
            pid: 12345,
            ppid: 12344,
            envIndicators: {
              isVscode: false,
              isCursor: false,
              isJetbrains: false,
              isTmux: false,
              isCi: false,
            },
          },
        },
      ];

      const formatted = formatLogList(entries);

      expect(formatted).toContain('Batch Update 操作日志');
      expect(formatted).toContain('cli');
    });

    it('应该处理空日志列表', () => {
      const formatted = formatLogList([]);
      expect(formatted).toContain('暂无 batch-update 操作日志');
    });
  });

  describe('showLogSummary', () => {
    it('应该返回日志统计摘要', () => {
      // 先写入一些日志
      const entry = {
        commandArgs: ['task', 'batch-update'],
        options: {},
        tasks: [],
        summary: {
          totalCount: 1,
          updatedCount: 1,
          filteredCount: 0,
        },
      };
      writeBatchUpdateLog(entry, TEST_DIR);

      const summary = showLogSummary(TEST_DIR);

      expect(typeof summary).toBe('string');
      expect(summary).toContain('Batch Update 日志统计');
    });

    it('应该处理无日志情况', () => {
      const summary = showLogSummary('/nonexistent/path');
      expect(summary).toContain('暂无 batch-update 操作日志');
    });
  });
});
