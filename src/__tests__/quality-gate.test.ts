/**
 * quality-gate 模块单元测试
 *
 * 测试质量门禁检查器的核心函数
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import {
  extractFilePaths,
  evaluateDescription,
  evaluateCheckpoints,
  evaluateSolution,
  evaluateRelatedFiles,
  validateBasicFields,
  extractAffectedFiles,
  DEFAULT_QUALITY_GATE_CONFIG,
} from '../utils/quality-gate.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

// ============================================================
// extractFilePaths
// ============================================================

describe('extractFilePaths', () => {
  // --- Normal cases ---

  it('should extract src paths', () => {
    const text = '修改 src/utils/helper.ts 文件';
    const result = extractFilePaths(text);
    expect(result).toContain('src/utils/helper.ts');
  });

  it('should extract relative paths', () => {
    const text = '查看 ./config.json 和 ../package.json';
    const result = extractFilePaths(text);
    expect(result).toContain('./config.json');
    expect(result).toContain('../package.json');
  });

  it('should extract paths with various extensions', () => {
    const text = 'src/index.ts src/component.tsx src/style.css';
    const result = extractFilePaths(text);
    // extractFilePaths may extract more patterns (e.g., partial matches)
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/component.tsx');
    expect(result).toContain('src/style.css');
  });

  it('should deduplicate paths', () => {
    const text = 'src/index.ts 和 src/index.ts 是同一个文件';
    const result = extractFilePaths(text);
    expect(result.filter(p => p === 'src/index.ts').length).toBe(1);
  });

  // --- Edge cases ---

  it('should return empty array for text without paths', () => {
    const result = extractFilePaths('这是一段没有文件路径的文字');
    expect(result).toEqual([]);
  });

  it('should handle empty string', () => {
    const result = extractFilePaths('');
    expect(result).toEqual([]);
  });

  it('should include bare filenames when option is true', () => {
    const text = '修改 index.ts 文件';
    const result = extractFilePaths(text, { includeBareFilenames: true });
    expect(result).toContain('index.ts');
  });

  it('should exclude bare filenames when option is false', () => {
    const text = '修改 index.ts 文件';
    const result = extractFilePaths(text, { includeBareFilenames: false });
    expect(result).not.toContain('index.ts');
  });
});

// ============================================================
// evaluateDescription
// ============================================================

describe('evaluateDescription', () => {
  // --- Normal cases ---

  it('should return high score for good description', () => {
    const description = `## 问题描述
用户登录时出现超时错误。

## 根因分析
数据库连接池配置不当导致连接超时。

## 解决方案
调整连接池参数，增加超时时间。`;
    const result = evaluateDescription(description);
    expect(result.score).toBeGreaterThan(70);
  });

  it('should deduct points for short description', () => {
    const result = evaluateDescription('简短描述');
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('过短'))).toBe(true);
  });

  // --- Edge cases ---

  it('should return 0 for empty description', () => {
    const result = evaluateDescription('');
    expect(result.score).toBe(0);
    expect(result.deductions.some(d => d.reason.includes('缺少描述'))).toBe(true);
  });

  it('should return 0 for undefined description', () => {
    const result = evaluateDescription(undefined);
    expect(result.score).toBe(0);
  });

  it('should deduct for missing structured sections', () => {
    const description = '这是一个没有结构化段落的描述，但是长度足够长，超过了五十个字符的限制，并且没有根因分析。';
    const result = evaluateDescription(description);
    // May deduct for missing root cause analysis or structured sections
    expect(result.deductions.length).toBeGreaterThan(0);
  });
});

// ============================================================
// evaluateCheckpoints
// ============================================================

describe('evaluateCheckpoints', () => {
  // --- Normal cases ---

  it('should return high score for good checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP-001', description: '实现用户登录 API 接口', status: 'pending' },
      { id: 'CP-002', description: '编写单元测试覆盖登录逻辑', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.score).toBeGreaterThan(80);
  });

  it('should deduct for generic checkpoints', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP-001', description: '核心功能实现', status: 'pending' },
      { id: 'CP-002', description: '测试通过', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.deductions.some(d => d.reason.includes('泛化'))).toBe(true);
  });

  // --- Edge cases ---

  it('should return 100 for empty checkpoints with none policy', () => {
    const result = evaluateCheckpoints([], 'none');
    expect(result.score).toBe(100);
  });

  it('should deduct heavily for empty checkpoints with required policy', () => {
    const result = evaluateCheckpoints([], 'required');
    expect(result.score).toBeLessThan(70);
    expect(result.deductions.some(d => d.reason.includes('必须配置检查点'))).toBe(true);
  });

  it('should deduct for single checkpoint', () => {
    const checkpoints: CheckpointMetadata[] = [
      { id: 'CP-001', description: '实现功能', status: 'pending' },
    ];
    const result = evaluateCheckpoints(checkpoints);
    expect(result.deductions.some(d => d.reason.includes('数量过少'))).toBe(true);
  });
});

// ============================================================
// evaluateSolution
// ============================================================

describe('evaluateSolution', () => {
  // --- Normal cases ---

  it('should return high score for structured solution', () => {
    const description = `## 解决方案
1. 修改配置文件
2. 重启服务`;
    const result = evaluateSolution(description);
    expect(result.score).toBe(100);
  });

  it('should deduct for missing solution section', () => {
    const description = '这是一个问题描述，但没有解决方案。';
    const result = evaluateSolution(description);
    expect(result.score).toBeLessThan(100);
  });

  // --- Edge cases ---

  it('should return 100 for empty description', () => {
    const result = evaluateSolution('');
    expect(result.score).toBe(100);
  });

  it('should deduct for unstructured solution keywords', () => {
    const description = '应该修改配置文件来解决这个问题。';
    const result = evaluateSolution(description);
    expect(result.deductions.some(d => d.reason.includes('未结构化'))).toBe(true);
  });
});

// ============================================================
// evaluateRelatedFiles
// ============================================================

describe('evaluateRelatedFiles', () => {
  // --- Normal cases ---

  it('should return high score when files are mentioned', () => {
    const description = '修改 src/utils/helper.ts 文件';
    const result = evaluateRelatedFiles(description);
    expect(result.score).toBe(100);
  });

  it('should deduct for missing related files', () => {
    const description = '这是一个没有文件引用的描述';
    const result = evaluateRelatedFiles(description);
    expect(result.score).toBeLessThan(100);
    expect(result.deductions.some(d => d.reason.includes('缺少关联文件'))).toBe(true);
  });

  // --- Edge cases ---

  it('should detect related files section', () => {
    const description = `## 相关文件
- src/index.ts`;
    const result = evaluateRelatedFiles(description);
    expect(result.score).toBe(100);
  });

  it('should handle undefined description', () => {
    const result = evaluateRelatedFiles(undefined);
    expect(result.score).toBeLessThan(100);
  });
});

// ============================================================
// validateBasicFields
// ============================================================

describe('validateBasicFields', () => {
  // --- Normal cases ---

  it('should return valid for complete task', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: '这是一个测试任务的描述，长度足够。',
      status: 'pending',
      checkpoints: [
        { id: 'CP-001', description: '检查点一', status: 'pending' },
      ],
    };
    const result = validateBasicFields(task);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  // --- Edge cases ---

  it('should return invalid for missing id', () => {
    const task = {
      id: '',
      title: '测试任务',
      description: '这是一个测试任务的描述。',
    } as TaskMeta;
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('id');
  });

  it('should return invalid for missing title', () => {
    const task = {
      id: 'TASK-001',
      title: '',
      description: '这是一个测试任务的描述。',
    } as TaskMeta;
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('title');
  });

  it('should return invalid for short description', () => {
    const task = {
      id: 'TASK-001',
      title: '测试任务',
      description: '短描述',
    } as TaskMeta;
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('description');
  });

  it('should return invalid for missing checkpoints with required policy', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: '这是一个测试任务的描述，长度足够。',
      status: 'pending',
      checkpointPolicy: 'required',
    };
    const result = validateBasicFields(task);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('checkpoints');
  });
});

// ============================================================
// extractAffectedFiles
// ============================================================

describe('extractAffectedFiles', () => {
  // --- Normal cases ---

  it('should extract files from related files section', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: `## 相关文件
- src/index.ts
- src/utils/helper.ts`,
      status: 'pending',
    };
    const result = extractAffectedFiles(task);
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils/helper.ts');
  });

  it('should extract files from description text', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: '修改 src/config.json 文件',
      status: 'pending',
    };
    const result = extractAffectedFiles(task);
    expect(result).toContain('src/config.json');
  });

  // --- Edge cases ---

  it('should return empty array for task without files', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: '没有文件引用的描述',
      status: 'pending',
    };
    const result = extractAffectedFiles(task);
    expect(result).toEqual([]);
  });

  it('should deduplicate files', () => {
    const task: TaskMeta = {
      id: 'TASK-001',
      title: '测试任务',
      description: `## 相关文件
- src/index.ts

修改 src/index.ts 文件`,
      status: 'pending',
    };
    const result = extractAffectedFiles(task);
    expect(result.filter(f => f === 'src/index.ts').length).toBe(1);
  });
});

// ============================================================
// Constants
// ============================================================

describe('DEFAULT_QUALITY_GATE_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_QUALITY_GATE_CONFIG.minQualityScore).toBe(60);
    expect(DEFAULT_QUALITY_GATE_CONFIG.requireSolutionConfirmation).toBe(true);
    expect(DEFAULT_QUALITY_GATE_CONFIG.requireAffectedFiles).toBe(true);
    expect(DEFAULT_QUALITY_GATE_CONFIG.requireChangeSize).toBe(false);
    expect(DEFAULT_QUALITY_GATE_CONFIG.enabled).toBe(true);
  });
});
