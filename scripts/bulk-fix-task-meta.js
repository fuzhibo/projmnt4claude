#!/usr/bin/env bun
/**
 * 批量修复任务 meta.json 缺失字段
 * 添加: subtaskIds, discussionTopics, fileWarnings, allowedTools
 */
import * as fs from 'fs';
import * as path from 'path';
const TASKS_DIR = '.projmnt4claude/tasks';
// 需要修复的任务列表
const TASKS_TO_FIX = [
    'TASK-bug-P0-harness-assembly-line-codeReviewVerdict-undefined-20260414',
    'TASK-feature-P1-analyze-fix-checkpoint-prefix-20260414',
    'TASK-feature-P2-schema-migration-checkpoint-prefix-20260414',
    'TASK-research-P2-analyze-ts-quality-gate-ts-analyze-e-20260409',
    'TASK-research-P2-llm-training-data-pipeline-20260413',
    'TASK-docs-P2-fix-init-requirement-help-20260413',
    'TASK-docs-P2-fix-task-command-help-20260413',
    'TASK-docs-P3-polish-harness-help-20260413',
    'TASK-refactor-P3-deprecate-branch-command-20260413',
    'TASK-refactor-P3-deprecate-human-verification-20260413',
    'TASK-refactor-P3-deprecate-tool-command-20260413',
    'TASK-feature-P2-plan-query-regex-support-20260413',
];
function fixTaskMeta(taskId) {
    const metaPath = path.join(TASKS_DIR, taskId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
        console.log(`❌ ${taskId}: meta.json 不存在`);
        return false;
    }
    try {
        const content = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(content);
        let modified = false;
        // 添加缺失的字段
        if (!meta.subtaskIds) {
            meta.subtaskIds = [];
            modified = true;
        }
        if (!meta.discussionTopics) {
            meta.discussionTopics = [];
            modified = true;
        }
        if (!meta.fileWarnings) {
            meta.fileWarnings = [];
            modified = true;
        }
        if (!meta.allowedTools) {
            meta.allowedTools = [];
            modified = true;
        }
        // 确保 checkpoints 存在
        if (!meta.checkpoints) {
            meta.checkpoints = [];
            modified = true;
        }
        // 确保 dependencies 存在（数组类型）
        if (!meta.dependencies) {
            meta.dependencies = [];
            modified = true;
        }
        // 确保 history 存在（数组类型）
        if (!meta.history) {
            meta.history = [];
            modified = true;
        }
        if (modified) {
            meta.updatedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
            console.log(`✅ ${taskId}: 已修复`);
            return true;
        }
        else {
            console.log(`ℹ️  ${taskId}: 无需修复`);
            return true;
        }
    }
    catch (error) {
        console.log(`❌ ${taskId}: 修复失败 - ${error}`);
        return false;
    }
}
// 主函数
console.log('🔧 批量修复任务 meta.json 缺失字段\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let successCount = 0;
let failCount = 0;
for (const taskId of TASKS_TO_FIX) {
    if (fixTaskMeta(taskId)) {
        successCount++;
    }
    else {
        failCount++;
    }
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n📊 统计: ✅ ${successCount} 成功 | ❌ ${failCount} 失败`);
console.log('\n💡 提示: 请重新运行 harness design 命令验证修复效果');
