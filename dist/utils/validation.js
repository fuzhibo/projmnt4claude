/**
 * 任务验证模块
 *
 * 提供任务完成条件的统一验证逻辑，包括：
 * - 检查点完成度验证
 * - 禁止 manual 验证检查
 * - 验证命令执行
 * - 证据收集
 */
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getProjectDir } from './path';
import { readTaskMeta, getAllTasks } from './task';
/**
 * 获取证据目录路径
 */
export function getEvidenceDir(taskId, cwd = process.cwd()) {
    return path.join(getProjectDir(cwd), 'evidence', taskId);
}
/**
 * 确保证据目录存在
 */
export function ensureEvidenceDir(taskId, cwd = process.cwd()) {
    const evidenceDir = getEvidenceDir(taskId, cwd);
    if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
    }
    return evidenceDir;
}
/**
 * 执行验证命令并收集证据
 */
export async function executeVerificationCommands(taskId, checkpointId, commands, cwd = process.cwd()) {
    const evidenceDir = ensureEvidenceDir(taskId, cwd);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const evidenceFileName = `${checkpointId}-${timestamp}.log`;
    const evidencePath = path.join(evidenceDir, evidenceFileName);
    let combinedOutput = '';
    let lastExitCode = 0;
    const header = `# 验证证据
任务ID: ${taskId}
检查点: ${checkpointId}
时间: ${new Date().toISOString()}
========================================\n\n`;
    combinedOutput += header;
    for (const cmd of commands) {
        combinedOutput += `$ ${cmd}\n`;
        try {
            const result = execSync(cmd, {
                cwd,
                encoding: 'utf-8',
                timeout: 60000,
                stdio: ['pipe', 'pipe', 'pipe'],
                maxBuffer: 10 * 1024 * 1024, // 10MB
            });
            combinedOutput += result;
            combinedOutput += '\n[EXIT CODE: 0]\n\n';
        }
        catch (error) {
            const execError = error;
            lastExitCode = execError.status || 1;
            combinedOutput += `[EXIT CODE: ${lastExitCode}]\n`;
            if (execError.stderr) {
                combinedOutput += execError.stderr;
            }
            else if (execError.message) {
                combinedOutput += execError.message;
            }
            combinedOutput += '\n\n';
        }
    }
    // 写入证据文件
    fs.writeFileSync(evidencePath, combinedOutput, 'utf-8');
    return {
        exitCode: lastExitCode,
        output: combinedOutput,
        evidencePath: path.relative(cwd, evidencePath),
    };
}
/**
 * 验证任务完成条件
 *
 * 检查项：
 * 1. 任务是否存在
 * 2. 检查点是否全部完成
 * 3. 是否使用了禁止的 manual 验证方法
 * 4. 验证命令是否执行成功
 * 5. 证据是否已收集
 */
export async function validateTaskCompletion(taskId, cwd = process.cwd(), options = {}) {
    const errors = [];
    const warnings = [];
    const evidenceCollected = [];
    const { executeCommands = true, collectEvidence = true } = options;
    // 1. 读取任务元数据
    const task = readTaskMeta(taskId, cwd);
    if (!task) {
        errors.push({
            code: 'TASK_NOT_FOUND',
            message: `任务 ${taskId} 不存在`,
        });
        return { valid: false, errors, warnings, evidenceCollected };
    }
    // 2. 检查检查点完成度
    const checkpoints = task.checkpoints || [];
    const incompleteCheckpoints = checkpoints.filter((cp) => cp.status !== 'completed' && cp.status !== 'skipped');
    if (incompleteCheckpoints.length > 0) {
        errors.push({
            code: 'INCOMPLETE_CHECKPOINTS',
            message: `有 ${incompleteCheckpoints.length} 个检查点未完成`,
            details: incompleteCheckpoints.map((cp) => `${cp.id}: ${cp.description}`),
        });
    }
    // 3. 禁止 manual 验证
    const manualCheckpoints = checkpoints.filter((cp) => cp.verification?.method === 'manual');
    if (manualCheckpoints.length > 0) {
        errors.push({
            code: 'MANUAL_VERIFICATION_NOT_ALLOWED',
            message: `禁止使用 manual 验证方法`,
            details: manualCheckpoints.map((cp) => `${cp.id}: 请使用 code_review/lint/functional_test/e2e_test/architect_review/automated 等具体验证方法`),
        });
    }
    // 4. 执行验证命令并收集证据
    if (executeCommands && collectEvidence) {
        for (const cp of checkpoints) {
            if (cp.status !== 'completed' || !cp.verification?.commands)
                continue;
            // 跳过 manual 验证（已在上面报错）
            if (cp.verification?.method === 'manual')
                continue;
            try {
                const evidence = await executeVerificationCommands(taskId, cp.id, cp.verification.commands, cwd);
                if (evidence.exitCode !== 0) {
                    errors.push({
                        code: 'VERIFICATION_COMMAND_FAILED',
                        message: `检查点 ${cp.id} 验证命令执行失败 (exit code: ${evidence.exitCode})`,
                        details: [evidence.output.substring(0, 500)],
                    });
                }
                else {
                    evidenceCollected.push(evidence.evidencePath);
                }
            }
            catch (error) {
                errors.push({
                    code: 'VERIFICATION_COMMAND_ERROR',
                    message: `检查点 ${cp.id} 验证命令执行异常: ${error}`,
                });
            }
        }
    }
    // 5. 检查验证证据
    const missingEvidence = checkpoints.filter((cp) => cp.status === 'completed' &&
        cp.verification &&
        !cp.verification.evidencePath &&
        !evidenceCollected.some(p => p.includes(cp.id)));
    if (missingEvidence.length > 0) {
        warnings.push({
            code: 'MISSING_EVIDENCE',
            message: `${missingEvidence.length} 个已完成的检查点缺少验证证据`,
            details: missingEvidence.map((cp) => cp.id),
        });
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        evidenceCollected,
    };
}
/**
 * 获取指定状态的所有任务
 */
export function getTasksByStatus(status, cwd = process.cwd()) {
    const tasks = getAllTasks(cwd, false);
    return tasks.filter(task => task.status === status);
}
/**
 * 获取所有 wait_evaluation 状态的任务
 */
export function getWaitEvaluationTasks(cwd = process.cwd()) {
    return getTasksByStatus('wait_evaluation', cwd);
}
/**
 * 批量验证多个任务
 */
export async function validateMultipleTasks(taskIds, cwd = process.cwd(), options) {
    const results = new Map();
    for (const taskId of taskIds) {
        const result = await validateTaskCompletion(taskId, cwd, options);
        results.set(taskId, result);
    }
    return results;
}
/**
 * 检查任务是否有 manual 验证的检查点
 */
export function hasManualVerification(task) {
    const checkpoints = task.checkpoints || [];
    return checkpoints.some((cp) => cp.verification?.method === 'manual');
}
/**
 * 获取所有使用 manual 验证的任务
 */
export function getTasksWithManualVerification(cwd = process.cwd()) {
    const tasks = getAllTasks(cwd, false);
    return tasks.filter(hasManualVerification);
}
/**
 * 生成验证报告
 */
export function generateValidationReport(taskId, result) {
    const lines = [];
    lines.push(`# 任务验证报告: ${taskId}`);
    lines.push(`时间: ${new Date().toISOString()}`);
    lines.push(`结果: ${result.valid ? '✅ 通过' : '❌ 失败'}`);
    lines.push('');
    if (result.errors.length > 0) {
        lines.push('## 错误');
        result.errors.forEach((err, i) => {
            lines.push(`${i + 1}. [${err.code}] ${err.message}`);
            if (err.details) {
                err.details.forEach(d => lines.push(`   - ${d}`));
            }
        });
        lines.push('');
    }
    if (result.warnings.length > 0) {
        lines.push('## 警告');
        result.warnings.forEach((warn, i) => {
            lines.push(`${i + 1}. [${warn.code}] ${warn.message}`);
            if (warn.details) {
                warn.details.forEach(d => lines.push(`   - ${d}`));
            }
        });
        lines.push('');
    }
    if (result.evidenceCollected.length > 0) {
        lines.push('## 收集的证据');
        result.evidenceCollected.forEach(p => lines.push(`- ${p}`));
        lines.push('');
    }
    return lines.join('\n');
}
/**
 * 清理证据文件
 *
 * @param taskId 任务ID，如果不指定则清理所有任务的过期证据
 * @param maxAge 最大保留天数
 */
export function cleanupEvidence(taskId, maxAge = 30, cwd = process.cwd()) {
    const evidenceBaseDir = path.join(getProjectDir(cwd), 'evidence');
    if (!fs.existsSync(evidenceBaseDir)) {
        return { deletedCount: 0, freedBytes: 0 };
    }
    let deletedCount = 0;
    let freedBytes = 0;
    const cutoffTime = Date.now() - maxAge * 24 * 60 * 60 * 1000;
    const dirsToClean = taskId
        ? [path.join(evidenceBaseDir, taskId)]
        : fs.readdirSync(evidenceBaseDir).map(name => path.join(evidenceBaseDir, name));
    for (const dir of dirsToClean) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
            continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.mtime.getTime() < cutoffTime) {
                freedBytes += stat.size;
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        }
    }
    return { deletedCount, freedBytes };
}
