import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, createLogger, type LogLevel, type AICostSummary, type InstrumentationRecord } from '../utils/logger';
import { getLogsDir } from '../utils/path';

describe('Logger', () => {
  const testCwd = path.join(process.cwd(), '.test-logs');
  let consoleSpy: {
    log: ReturnType<typeof mock>;
    error: ReturnType<typeof mock>;
    warn: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testCwd)) {
      fs.rmSync(testCwd, { recursive: true, force: true });
    }
    fs.mkdirSync(testCwd, { recursive: true });

    // Mock console methods
    consoleSpy = {
      log: mock(() => {}),
      error: mock(() => {}),
      warn: mock(() => {}),
    };
    console.log = consoleSpy.log;
    console.error = consoleSpy.error;
    console.warn = consoleSpy.warn;
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testCwd)) {
      fs.rmSync(testCwd, { recursive: true, force: true });
    }
  });

  describe('Basic Logging', () => {
    test('should log info message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.info('Test info message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    test('should log error message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.error('Test error message');
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    test('should log warn message', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.warn('Test warn message');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    test('should log debug message when level is debug', () => {
      const originalLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'debug';
      const logger = new Logger({ cwd: testCwd });
      logger.debug('Test debug message');
      expect(consoleSpy.log).toHaveBeenCalled();
      // Reset environment
      if (originalLevel) {
        process.env.LOG_LEVEL = originalLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }
    });

    test('should include data in log output', () => {
      const logger = new Logger({ cwd: testCwd });
      const testData = { key: 'value', count: 42 };
      logger.info('Test with data', testData);
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('Component Labeling', () => {
    test('should create child logger with component', () => {
      const logger = new Logger({ cwd: testCwd, component: 'parent' });
      const childLogger = logger.child('child');

      childLogger.info('Child message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    test('should create nested child loggers', () => {
      const logger = new Logger({ cwd: testCwd, component: 'root' });
      const child1 = logger.child('level1');
      const child2 = child1.child('level2');

      child2.info('Nested message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    test('should prefix logs with component name', () => {
      const logger = new Logger({ cwd: testCwd, component: 'TestComponent' });
      logger.info('Component message');

      const calls = consoleSpy.log.mock.calls as string[][];
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toContain('[TestComponent]');
    });
  });

  describe('Command Logging', () => {
    test('should log command start', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.logCommandStart('test-command', { arg1: 'value1' });

      expect(consoleSpy.log).toHaveBeenCalled();
      const calls = consoleSpy.log.mock.calls as string[][];
      expect(calls[0][0]).toContain('test-command');
    });

    test('should log command end', () => {
      const logger = new Logger({ cwd: testCwd });
      logger.logCommandStart('test-command');
      logger.logCommandEnd('test-command', 0);

      const calls = consoleSpy.log.mock.calls as string[][];
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

      const logger = new Logger({ cwd: testCwd });
      logger.info('This should not appear');
      logger.error('This should appear');

      // Reset environment
      if (originalLevel) {
        process.env.LOG_LEVEL = originalLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    test('should filter by log level', () => {
      const logger = new Logger({ cwd: testCwd });

      // At default 'info' level, debug should not be logged
      // Note: This depends on the actual implementation behavior
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy.log).toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
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
      expect(consoleSpy.log).toHaveBeenCalled();
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
      expect(consoleSpy.log).toHaveBeenCalled();
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

      expect(consoleSpy.log).toHaveBeenCalled();
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
