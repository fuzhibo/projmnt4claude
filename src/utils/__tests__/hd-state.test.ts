/**
 * hd-state.ts 单元测试
 *
 * 覆盖检查点:
 * - CP-001/002/003: saveState 保存状态
 * - CP-004/005/006: loadState 加载状态
 * - CP-007/008/009: validateState 状态验证
 * - CP-010/011/012: updateStateProgress 更新进度
 * - CP-013/014/015: phase 状态转换
 * - Bug#1 回归测试: Map 序列化
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  saveState,
  loadState,
  validateState,
  updateStateProgress,
  transitionPhase,
  createDefaultState,
  clearState,
  getStateFilePath,
  type StateValidationResult,
} from '../hd-state.js';
import type { HarnessConfig, HarnessRuntimeState } from '../../types/harness.js';
import { createDefaultRuntimeState } from '../../types/harness.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestConfig(cwd: string): HarnessConfig {
  return {
    maxRetries: 3,
    timeout: 300,
    parallel: 1,
    dryRun: false,
    continue: false,
    jsonOutput: false,
    cwd,
    batchGitTagCommit: false,
    taskGitCommit: false,
    forceContinue: false,
  };
}

function createTestState(config: HarnessConfig, overrides: Partial<HarnessRuntimeState> = {}): HarnessRuntimeState {
  const state = createDefaultRuntimeState(config);
  state.taskQueue = ['TASK-001', 'TASK-002', 'TASK-003'];
  return { ...state, ...overrides };
}

// ============================================================
// Tests
// ============================================================

describe('hd-state', () => {
  let tempDir: string;
  let config: HarnessConfig;

  beforeEach(() => {
    // Create isolated temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-state-test-'));
    config = createTestConfig(tempDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  // ============================================================
  // CP-001/002/003: saveState 保存状态
  // ============================================================

  describe('saveState', () => {
    // --- CP-001: Normal input handling ---

    it('should save state to file successfully', () => {
      const state = createTestState(config);
      state.currentIndex = 1;
      state.retryCounter.set('TASK-001', 2);

      saveState(state, tempDir);

      const statePath = getStateFilePath(tempDir);
      expect(fs.existsSync(statePath)).toBe(true);

      const content = fs.readFileSync(statePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.state).toBe('idle');
      expect(data.currentIndex).toBe(1);
      expect(data.retryCounter).toEqual({ 'TASK-001': 2 });
    });

    it('should serialize Maps to plain objects', () => {
      const state = createTestState(config);
      state.retryCounter.set('TASK-001', 1);
      state.retryCounter.set('TASK-002', 2);
      state.resumeFrom.set('TASK-001', 'qa');
      state.phaseRetryCounters.set('TASK-001:development', 1);
      state.taskPhaseCheckpoints.set('TASK-001', {
        completedPhase: 'development',
        completedAt: '2024-01-01T00:00:00.000Z',
      });

      saveState(state, tempDir);

      const content = fs.readFileSync(getStateFilePath(tempDir), 'utf-8');
      const data = JSON.parse(content);

      expect(data.retryCounter).toEqual({ 'TASK-001': 1, 'TASK-002': 2 });
      expect(data.resumeFrom).toEqual({ 'TASK-001': 'qa' });
      expect(data.phaseRetryCounters).toEqual({ 'TASK-001:development': 1 });
      expect(data.taskPhaseCheckpoints).toEqual({
        'TASK-001': { completedPhase: 'development', completedAt: '2024-01-01T00:00:00.000Z' },
      });
    });

    // --- CP-002: Boundary conditions (empty Maps) ---

    it('should handle empty Maps correctly', () => {
      const state = createTestState(config);
      // Maps are empty by default

      saveState(state, tempDir);

      const content = fs.readFileSync(getStateFilePath(tempDir), 'utf-8');
      const data = JSON.parse(content);

      expect(data.retryCounter).toEqual({});
      expect(data.resumeFrom).toEqual({});
      expect(data.phaseRetryCounters).toEqual({});
      expect(data.taskPhaseCheckpoints).toEqual({});
    });

    it('should save stateFormatVersion as 2', () => {
      const state = createTestState(config);

      saveState(state, tempDir);

      const content = fs.readFileSync(getStateFilePath(tempDir), 'utf-8');
      const data = JSON.parse(content);

      expect(data.stateFormatVersion).toBe(2);
    });

    // --- CP-003: Exception handling (directory creation) ---

    it('should create directory if not exists', () => {
      const nonExistentDir = path.join(tempDir, 'nested', 'deep', 'path');
      const newConfig = createTestConfig(nonExistentDir);
      const state = createTestState(newConfig);

      expect(fs.existsSync(nonExistentDir)).toBe(false);

      saveState(state, nonExistentDir);

      expect(fs.existsSync(nonExistentDir)).toBe(true);
      expect(fs.existsSync(getStateFilePath(nonExistentDir))).toBe(true);
    });

    it('should create .projmnt4claude directory if not exists', () => {
      const state = createTestState(config);
      const projDir = path.join(tempDir, '.projmnt4claude');

      // Remove the directory if it exists
      if (fs.existsSync(projDir)) {
        fs.rmSync(projDir, { recursive: true, force: true });
      }

      expect(fs.existsSync(projDir)).toBe(false);

      saveState(state, tempDir);

      expect(fs.existsSync(projDir)).toBe(true);
    });
  });

  // ============================================================
  // CP-004/005/006: loadState 加载状态
  // ============================================================

  describe('loadState', () => {
    // --- CP-004: Normal input handling ---

    it('should load state from file successfully', () => {
      const state = createTestState(config);
      state.currentIndex = 2;
      state.retryCounter.set('TASK-001', 3);
      saveState(state, tempDir);

      const loaded = loadState(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded!.state).toBe('idle');
      expect(loaded!.currentIndex).toBe(2);
      expect(loaded!.retryCounter.get('TASK-001')).toBe(3);
    });

    it('should restore Maps from serialized objects', () => {
      const state = createTestState(config);
      state.retryCounter.set('TASK-001', 1);
      state.resumeFrom.set('TASK-002', 'code_review');
      state.phaseRetryCounters.set('TASK-001:qa', 2);
      state.taskPhaseCheckpoints.set('TASK-003', {
        completedPhase: 'evaluation',
        completedAt: '2024-01-15T10:30:00.000Z',
      });
      saveState(state, tempDir);

      const loaded = loadState(tempDir);

      expect(loaded!.retryCounter).toBeInstanceOf(Map);
      expect(loaded!.resumeFrom).toBeInstanceOf(Map);
      expect(loaded!.phaseRetryCounters).toBeInstanceOf(Map);
      expect(loaded!.taskPhaseCheckpoints).toBeInstanceOf(Map);
      expect(loaded!.retryCounter.get('TASK-001')).toBe(1);
      expect(loaded!.resumeFrom.get('TASK-002')).toBe('code_review');
      expect(loaded!.phaseRetryCounters.get('TASK-001:qa')).toBe(2);
      expect(loaded!.taskPhaseCheckpoints.get('TASK-003')?.completedPhase).toBe('evaluation');
    });

    // --- CP-005: Boundary conditions (file not found, empty file) ---

    it('should return null if state file does not exist', () => {
      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    it('should return null if state file is empty', () => {
      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '', 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    it('should return null if state file contains only whitespace', () => {
      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '   \n\t  ', 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    // --- CP-006: Exception handling (invalid JSON) ---

    it('should return null if state file contains invalid JSON', () => {
      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '{ invalid json }', 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    it('should return null if state file contains non-object JSON', () => {
      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '"just a string"', 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    it('should return null if stateFormatVersion is invalid', () => {
      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ stateFormatVersion: 99 }), 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).toBeNull();
    });

    it('should migrate v1 state to v2', () => {
      const v1Data = {
        stateFormatVersion: 1,
        state: 'idle',
        config: createTestConfig(tempDir),
        taskQueue: ['TASK-001'],
        currentIndex: 0,
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const statePath = getStateFilePath(tempDir);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(v1Data), 'utf-8');

      const loaded = loadState(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded!.taskQueue).toEqual(['TASK-001']);
    });
  });

  // ============================================================
  // CP-007/008/009: validateState 状态验证
  // ============================================================

  describe('validateState', () => {
    // --- CP-007: Normal input handling ---

    it('should validate correct state data', () => {
      const data = {
        state: 'running',
        config: createTestConfig(tempDir),
        taskQueue: ['TASK-001', 'TASK-002'],
        currentIndex: 1,
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      };

      const { data: validated, validation } = validateState(data, tempDir);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validated).not.toBeNull();
      expect(validated!.state).toBe('running');
      expect(validated!.taskQueue).toEqual(['TASK-001', 'TASK-002']);
    });

    it('should repair optional fields with defaults', () => {
      const data = {
        state: 'idle',
        config: createTestConfig(tempDir),
        taskQueue: [],
        currentIndex: 0,
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        // Missing optional fields
      };

      const { data: validated, validation } = validateState(data, tempDir);

      expect(validation.valid).toBe(true);
      expect(validation.repaired).toBe(true);
      expect(validation.repairedFields).toContain('retryCounter');
      expect(validation.repairedFields).toContain('resumeFrom');
      expect(validation.repairedFields).toContain('phaseRetryCounters');
      expect(validated!.retryCounter).toBeInstanceOf(Map);
      expect(validated!.batchBoundaries).toEqual([]);
    });

    // --- CP-008: Boundary conditions (missing optional fields) ---

    it('should handle missing batchBoundaries', () => {
      const data = {
        state: 'idle',
        config: createTestConfig(tempDir),
        taskQueue: [],
        currentIndex: 0,
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { data: validated } = validateState(data, tempDir);

      expect(validated!.batchBoundaries).toEqual([]);
    });

    it('should handle missing passedTasks/failedTasks/retryingTasks', () => {
      const data = {
        state: 'idle',
        config: createTestConfig(tempDir),
        taskQueue: [],
        currentIndex: 0,
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { data: validated } = validateState(data, tempDir);

      expect(validated!.passedTasks).toEqual([]);
      expect(validated!.failedTasks).toEqual([]);
      expect(validated!.retryingTasks).toEqual([]);
    });

    // --- CP-009: Exception handling (invalid required fields) ---

    it('should return errors for missing required fields', () => {
      const data = {
        // Missing state, config, taskQueue, etc.
      };

      const { data: validated, validation } = validateState(data, tempDir);

      expect(validation.valid).toBe(false);
      expect(validated).toBeNull();
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.field === 'state')).toBe(true);
      expect(validation.errors.some(e => e.field === 'config')).toBe(true);
    });

    it('should return error for wrong type of required field', () => {
      const data = {
        state: 'idle',
        config: 'not an object',
        taskQueue: 'not an array',
        currentIndex: 'not a number',
        startTime: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { data: validated, validation } = validateState(data, tempDir);

      expect(validation.valid).toBe(false);
      expect(validated).toBeNull();
      expect(validation.errors.some(e => e.field === 'config')).toBe(true);
      expect(validation.errors.some(e => e.field === 'taskQueue')).toBe(true);
      expect(validation.errors.some(e => e.field === 'currentIndex')).toBe(true);
    });

    it('should handle null data', () => {
      const { data: validated, validation } = validateState(null as any, tempDir);

      expect(validation.valid).toBe(false);
      expect(validated).toBeNull();
    });
  });

  // ============================================================
  // CP-010/011/012: updateStateProgress 更新进度
  // ============================================================

  describe('updateStateProgress', () => {
    // --- CP-010: Normal input handling ---

    it('should update currentIndex and timestamp', async () => {
      const state = createTestState(config);
      state.taskQueue = ['TASK-001', 'TASK-002', 'TASK-003'];

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5));

      const updated = updateStateProgress(state, { currentIndex: 2 });

      expect(updated.currentIndex).toBe(2);
      expect(updated.updatedAt).not.toBe(state.updatedAt);
    });

    it('should add passedTask', () => {
      const state = createTestState(config);

      const updated = updateStateProgress(state, { passedTask: 'TASK-001' });

      expect(updated.passedTasks).toContain('TASK-001');
    });

    it('should add failedTask and remove from retryingTasks', () => {
      const state = createTestState(config);
      state.retryingTasks = ['TASK-001', 'TASK-002'];

      const updated = updateStateProgress(state, { failedTask: 'TASK-001' });

      expect(updated.failedTasks).toContain('TASK-001');
      expect(updated.retryingTasks).not.toContain('TASK-001');
      expect(updated.retryingTasks).toContain('TASK-002');
    });

    it('should add retryingTask', () => {
      const state = createTestState(config);

      const updated = updateStateProgress(state, { retryingTask: 'TASK-001' });

      expect(updated.retryingTasks).toContain('TASK-001');
    });

    it('should increment retry counter', () => {
      const state = createTestState(config);
      state.retryCounter.set('TASK-001', 1);

      const updated = updateStateProgress(state, {
        retryIncrement: { taskId: 'TASK-001', count: 1 },
      });

      expect(updated.retryCounter.get('TASK-001')).toBe(2);
    });

    it('should increment phase retry counter', () => {
      const state = createTestState(config);

      const updated = updateStateProgress(state, {
        phaseRetryIncrement: { taskId: 'TASK-001', phase: 'development', count: 1 },
      });

      expect(updated.phaseRetryCounters.get('TASK-001:development')).toBe(1);
    });

    it('should update phase checkpoint', () => {
      const state = createTestState(config);

      const updated = updateStateProgress(state, {
        phaseCheckpoint: {
          taskId: 'TASK-001',
          phase: 'qa',
          completedAt: '2024-01-01T12:00:00.000Z',
        },
      });

      expect(updated.taskPhaseCheckpoints.get('TASK-001')?.completedPhase).toBe('qa');
    });

    // --- CP-011: Boundary conditions (index out of range) ---

    it('should clamp currentIndex to valid range (upper bound)', () => {
      const state = createTestState(config);
      state.taskQueue = ['TASK-001', 'TASK-002'];

      const updated = updateStateProgress(state, { currentIndex: 100 });

      expect(updated.currentIndex).toBe(1); // Max index is taskQueue.length - 1
    });

    it('should clamp currentIndex to valid range (lower bound)', () => {
      const state = createTestState(config);
      state.taskQueue = ['TASK-001', 'TASK-002'];
      state.currentIndex = 1;

      const updated = updateStateProgress(state, { currentIndex: -5 });

      expect(updated.currentIndex).toBe(0);
    });

    it('should not add duplicate passedTask', () => {
      const state = createTestState(config);
      state.passedTasks = ['TASK-001'];

      const updated = updateStateProgress(state, { passedTask: 'TASK-001' });

      expect(updated.passedTasks).toEqual(['TASK-001']);
    });

    // --- CP-012: Exception handling (invalid state) ---

    it('should update state field', () => {
      const state = createTestState(config);

      const updated = updateStateProgress(state, { state: 'running' });

      expect(updated.state).toBe('running');
    });

    it('should create new Maps when updating counters', () => {
      const state = createTestState(config);
      state.retryCounter.set('TASK-001', 1);

      const updated = updateStateProgress(state, {
        retryIncrement: { taskId: 'TASK-002', count: 1 },
      });

      // Original map should not be modified
      expect(state.retryCounter.has('TASK-002')).toBe(false);
      // New map should have both entries
      expect(updated.retryCounter.get('TASK-001')).toBe(1);
      expect(updated.retryCounter.get('TASK-002')).toBe(1);
    });
  });

  // ============================================================
  // CP-013/014/015: phase 状态转换
  // ============================================================

  describe('transitionPhase', () => {
    // --- CP-013: Normal input handling ---

    it('should set resumeFrom to target phase and update timestamp', async () => {
      const state = createTestState(config);

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5));

      const updated = transitionPhase(state, 'TASK-001', 'qa');

      expect(updated.resumeFrom.get('TASK-001')).toBe('qa');
      expect(updated.updatedAt).not.toBe(state.updatedAt);
    });

    it('should support all phases', () => {
      const state = createTestState(config);
      const phases: Array<'development' | 'code_review' | 'qa' | 'evaluation'> = [
        'development',
        'code_review',
        'qa',
        'evaluation',
      ];

      for (const phase of phases) {
        const updated = transitionPhase(state, 'TASK-001', phase);
        expect(updated.resumeFrom.get('TASK-001')).toBe(phase);
      }
    });

    // --- CP-014: Boundary conditions (invalid phase) ---

    it('should return original state if taskId is empty', () => {
      const state = createTestState(config);

      const updated = transitionPhase(state, '', 'qa');

      expect(updated).toBe(state);
    });

    it('should return original state if targetPhase is empty string', () => {
      const state = createTestState(config);

      const updated = transitionPhase(state, 'TASK-001', '' as any);

      expect(updated).toBe(state);
    });

    // --- CP-015: Exception handling (empty state) ---

    it('should create new Maps when updating resumeFrom', () => {
      const state = createTestState(config);
      state.resumeFrom.set('TASK-OLD', 'development');

      const updated = transitionPhase(state, 'TASK-001', 'qa');

      // Original map should not be modified
      expect(state.resumeFrom.has('TASK-001')).toBe(false);
      // New map should have both entries
      expect(updated.resumeFrom.get('TASK-OLD')).toBe('development');
      expect(updated.resumeFrom.get('TASK-001')).toBe('qa');
    });
  });

  // ============================================================
  // Utility Functions
  // ============================================================

  describe('getStateFilePath', () => {
    it('should return correct path', () => {
      const cwd = '/project/root';
      const path = getStateFilePath(cwd);

      expect(path).toBe('/project/root/.projmnt4claude/harness-state.json');
    });
  });

  describe('createDefaultState', () => {
    it('should create state with all required fields', () => {
      const state = createDefaultState(config);

      expect(state.state).toBe('idle');
      expect(state.config).toBe(config);
      expect(state.taskQueue).toEqual([]);
      expect(state.currentIndex).toBe(0);
      expect(state.retryCounter).toBeInstanceOf(Map);
      expect(state.resumeFrom).toBeInstanceOf(Map);
    });
  });

  describe('clearState', () => {
    it('should remove state file if exists', () => {
      const state = createTestState(config);
      saveState(state, tempDir);

      expect(fs.existsSync(getStateFilePath(tempDir))).toBe(true);

      clearState(tempDir);

      expect(fs.existsSync(getStateFilePath(tempDir))).toBe(false);
    });

    it('should not throw if state file does not exist', () => {
      expect(() => clearState(tempDir)).not.toThrow();
    });
  });

  // ============================================================
  // Bug#1 Regression Test: Map Serialization
  // ============================================================

  describe('Bug#1: Map serialization regression', () => {
    it('should correctly serialize and deserialize Map with special characters in keys', () => {
      const state = createTestState(config);
      // Key with colon (used in phaseRetryCounters)
      state.phaseRetryCounters.set('TASK-001:development', 3);
      state.phaseRetryCounters.set('TASK-002:code_review', 1);

      saveState(state, tempDir);
      const loaded = loadState(tempDir);

      expect(loaded!.phaseRetryCounters.get('TASK-001:development')).toBe(3);
      expect(loaded!.phaseRetryCounters.get('TASK-002:code_review')).toBe(1);
    });

    it('should handle Map with numeric values', () => {
      const state = createTestState(config);
      state.retryCounter.set('TASK-001', 0);
      state.retryCounter.set('TASK-002', 999);

      saveState(state, tempDir);
      const loaded = loadState(tempDir);

      expect(loaded!.retryCounter.get('TASK-001')).toBe(0);
      expect(loaded!.retryCounter.get('TASK-002')).toBe(999);
    });

    it('should handle Map with object values', () => {
      const state = createTestState(config);
      state.taskPhaseCheckpoints.set('TASK-001', {
        completedPhase: 'evaluation',
        completedAt: '2024-12-31T23:59:59.999Z',
      });

      saveState(state, tempDir);
      const loaded = loadState(tempDir);

      const checkpoint = loaded!.taskPhaseCheckpoints.get('TASK-001');
      expect(checkpoint?.completedPhase).toBe('evaluation');
      expect(checkpoint?.completedAt).toBe('2024-12-31T23:59:59.999Z');
    });

    it('should preserve empty Maps after round-trip', () => {
      const state = createTestState(config);
      // All Maps are empty by default

      saveState(state, tempDir);
      const loaded = loadState(tempDir);

      expect(loaded!.retryCounter.size).toBe(0);
      expect(loaded!.resumeFrom.size).toBe(0);
      expect(loaded!.phaseRetryCounters.size).toBe(0);
      expect(loaded!.taskPhaseCheckpoints.size).toBe(0);
    });
  });
});
