/**
 * conversion-status.json 状态管理模块
 *
 * 记录每个调查报告的转换状态，支持断点续转：
 * - 读取或初始化 conversion-status.json
 * - 更新单个报告的转换状态
 * - 获取待转换的报告列表
 * - 按 dependsOn 拓扑排序
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ConversionStatus, ConversionState, ConversionTaskDetail } from './types.js';

const STATUS_FILE = 'conversion-status.json';

/** 读取或初始化 conversion-status.json */
export function loadConversionStatus(investigationDir: string): ConversionStatus {
  const filePath = path.join(investigationDir, STATUS_FILE);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return createEmptyConversionStatus();
}

/** 创建空的 conversion-status */
export function createEmptyConversionStatus(): ConversionStatus {
  return {
    reports: {},
    tasks: {},
    lastRunAt: new Date().toISOString(),
  };
}

/** 持久化 conversion-status 到磁盘 */
function saveConversionStatus(investigationDir: string, status: ConversionStatus): void {
  const filePath = path.join(investigationDir, STATUS_FILE);
  status.lastRunAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(status, null, 2), 'utf-8');
}

/** 更新单个报告的转换状态 */
export function updateConversionStatus(
  investigationDir: string,
  reportPath: string,
  state: ConversionState,
  detail?: { taskId?: string; lastError?: string; lastAttemptAt?: string },
): void {
  const status = loadConversionStatus(investigationDir);
  status.reports[reportPath] = state;

  if (detail) {
    const existing = status.tasks[reportPath] || {};
    status.tasks[reportPath] = {
      ...existing,
      ...detail,
    };
  }

  saveConversionStatus(investigationDir, status);
}

/** 获取待转换的报告列表（过滤 completed，保留 pending + failed） */
export function getPendingReports(status: ConversionStatus): string[] {
  return Object.entries(status.reports)
    .filter(([, state]) => state !== 'completed')
    .map(([reportPath]) => reportPath);
}

/** 按 dependsOn 拓扑排序报告列表 */
export function topologicalSort(
  reports: string[],
  status: ConversionStatus,
  investigationDir: string,
): string[] {
  // Build adjacency list: report -> reports it depends on
  const dependencies = new Map<string, Set<string>>();
  const allReports = new Set(reports);

  for (const report of reports) {
    const deps = new Set<string>();
    const metaPath = path.join(
      investigationDir,
      report.replace(/\.md$/, ''),
      'meta.json',
    );
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.dependsOn && Array.isArray(meta.dependsOn)) {
          for (const dep of meta.dependsOn) {
            if (allReports.has(dep)) {
              deps.add(dep);
            }
          }
        }
      } catch {
        // meta.json parse failure, ignore deps
      }
    }
    dependencies.set(report, deps);
  }

  // Kahn's algorithm: compute in-degree (number of reports that depend on this report)
  const inDegree = new Map<string, number>();
  for (const report of reports) {
    inDegree.set(report, 0);
  }

  // For each report, its dependencies must come first
  // So if A depends on B, B has an edge TO A → A's in-degree increases
  for (const report of reports) {
    const deps = dependencies.get(report) || new Set();
    // report depends on deps → deps must be processed before report
    // This means in-degree of report = number of its dependencies
    inDegree.set(report, deps.size);
  }

  const queue: string[] = [];
  for (const [report, degree] of inDegree) {
    if (degree === 0) {
      queue.push(report);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    // Find all reports that depend on current, decrease their in-degree
    for (const report of reports) {
      const deps = dependencies.get(report);
      if (deps && deps.has(current)) {
        const newDegree = (inDegree.get(report) || 1) - 1;
        inDegree.set(report, newDegree);
        if (newDegree === 0 && !sorted.includes(report)) {
          queue.push(report);
        }
      }
    }
  }

  if (sorted.length !== reports.length) {
    throw new Error('循环依赖检测：报告之间存在循环依赖，无法进行拓扑排序');
  }

  return sorted;
}