#!/usr/bin/env bun
/**
 * 批量修复任务检查点配置
 * - 添加前缀 [ai review]/[ai qa]/[human qa]/[script]
 * - automated 方法添加 commands/steps
 */
import * as fs from 'fs';
import * as path from 'path';
const TASKS_DIR = '.projmnt4claude/tasks';
// 需要修复的任务
const TASKS_TO_FIX = [
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
// 为描述添加前缀
function addPrefixToDescription(desc) {
    // 如果已经有前缀，跳过
    if (/^\[(ai review|ai qa|human qa|script)\]/i.test(desc.trim())) {
        return desc;
    }
    // 根据内容推断前缀
    const lowerDesc = desc.toLowerCase();
    if (lowerDesc.includes('验证') || lowerDesc.includes('检查') || lowerDesc.includes('确认')) {
        if (lowerDesc.includes('人工') || lowerDesc.includes('手动')) {
            return `[human qa] ${desc}`;
        }
        else if (lowerDesc.includes('脚本') || lowerDesc.includes('编译') || lowerDesc.includes('npm run') || lowerDesc.includes('运行自动化')) {
            return `[script] ${desc}`;
        }
        else {
            return `[ai qa] ${desc}`;
        }
    }
    // 默认 ai review
    return `[ai review] ${desc}`;
}
// 为 automated 验证方法生成 commands
function generateCommands(checkpoint) {
    const desc = checkpoint.description.toLowerCase();
    const notes = (checkpoint.notes || '').toLowerCase();
    // 根据描述内容生成相应的命令
    if (desc.includes('编译') || desc.includes('build') || notes.includes('npm run build')) {
        return ['npm run build'];
    }
    if (desc.includes('测试') || desc.includes('test') || desc.includes('验证') && desc.includes('运行')) {
        return ['npm test'];
    }
    if (desc.includes('类型检查') || desc.includes('typecheck')) {
        return ['npm run typecheck'];
    }
    if (desc.includes('导出') || desc.includes('training-data')) {
        return ['projmnt4claude analyze --bug-report --export-training-data'];
    }
    if (desc.includes('help') || desc.includes('--help')) {
        return ['projmnt4claude --help', 'projmnt4claude init-requirement --help'];
    }
    if (desc.includes('删除') || desc.includes('移除') || desc.includes('代码审查') || desc.includes('重构')) {
        return ['npm run build', 'npm test'];
    }
    // 默认命令
    return ['npm run build', 'npm test'];
}
function fixCheckpoints(taskId) {
    const metaPath = path.join(TASKS_DIR, taskId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
        console.log(`❌ ${taskId}: meta.json 不存在`);
        return false;
    }
    try {
        const content = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(content);
        let modified = false;
        if (!meta.checkpoints || meta.checkpoints.length === 0) {
            console.log(`ℹ️  ${taskId}: 无检查点`);
            return true;
        }
        for (const cp of meta.checkpoints) {
            // 修复 1: 添加前缀
            const originalDesc = cp.description;
            cp.description = addPrefixToDescription(cp.description);
            if (cp.description !== originalDesc) {
                modified = true;
            }
            // 修复 2: automated 方法添加 commands
            if (cp.verification && cp.verification.method === 'automated') {
                if (!cp.verification.commands && !cp.verification.steps) {
                    cp.verification.commands = generateCommands(cp);
                    modified = true;
                }
            }
        }
        if (modified) {
            meta.updatedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
            console.log(`✅ ${taskId}: 已修复 ${meta.checkpoints.length} 个检查点`);
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
console.log('🔧 批量修复任务检查点配置\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let successCount = 0;
let failCount = 0;
for (const taskId of TASKS_TO_FIX) {
    if (fixCheckpoints(taskId)) {
        successCount++;
    }
    else {
        failCount++;
    }
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n📊 统计: ✅ ${successCount} 成功 | ❌ ${failCount} 失败`);
console.log('\n💡 提示: 请重新运行 harness design 命令验证修复效果');
