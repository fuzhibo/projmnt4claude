/**
 * Harness 公共工具模块
 *
 * 提取公共代码，避免重复
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getProjectDir } from './path.js';
// ============================================================
// 常量定义
// ============================================================
/** 默认超时时间（秒） */
export const DEFAULT_TIMEOUT_SECONDS = 300;
/** 审核阶段超时比例（使用总超时的 1/3） */
export const REVIEW_TIMEOUT_RATIO = 3;
/**
 * 分析 Headless Claude 的 exit code 和 stderr，区分 hook 失败和任务失败。
 *
 * Hook 失败（如 SessionEnd hook cancelled）不应阻断流水线：
 * - hook 失败 + stdout 有有效输出 → 视为成功，附带警告
 * - hook 失败 + stdout 为空 → 保守判定为失败
 * - 非 hook 错误 → 真实的任务失败
 */
export function classifyExitResult(code, stderr, stdout) {
    if (code === 0) {
        return { success: true };
    }
    const isHookError = /hook\s+.*\s+failed/i.test(stderr)
        || /Hook cancelled/i.test(stderr)
        || /SessionEnd\s+hook/i.test(stderr);
    const hasOutput = stdout.trim().length > 0;
    if (isHookError && hasOutput) {
        return {
            success: true,
            hookWarning: `Hook 错误已忽略: ${stderr.substring(0, 200)}`,
        };
    }
    if (isHookError && !hasOutput) {
        return {
            success: false,
            error: `Hook 错误导致无输出: ${stderr.substring(0, 200)}`,
        };
    }
    return {
        success: false,
        error: stderr || `进程退出码: ${code}`,
    };
}
// ============================================================
// 公共函数
// ============================================================
export async function runHeadlessClaude(options) {
    return new Promise((resolve) => {
        // 注意：prompt 通过 stdin 传递，而不是命令行参数
        // 这样可以避免多行文本作为命令行参数时的解析问题
        const args = [
            '--allowedTools', options.allowedTools.join(','),
            '--print',
        ];
        if (options.dangerouslySkipPermissions) {
            args.push('--dangerously-skip-permissions');
        }
        if (options.outputFormat) {
            args.push('--output-format', options.outputFormat);
        }
        // Session 连续性支持
        if (options.sessionId) {
            args.push('--session-id', options.sessionId);
        }
        if (options.resumeSession) {
            args.push('--resume');
        }
        if (options.forkSession) {
            args.push('--fork-session');
        }
        try {
            const child = spawn('claude', args, {
                cwd: options.cwd,
                stdio: ['pipe', 'pipe', 'pipe'], // stdin 改为 pipe 以支持写入
                timeout: options.timeout * 1000,
            });
            // 通过 stdin 传递 prompt
            if (child.stdin) {
                child.stdin.write(options.prompt);
                child.stdin.end();
            }
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                const classified = classifyExitResult(code, stderr, stdout);
                resolve({
                    success: classified.success,
                    output: stdout,
                    error: classified.error,
                    hookWarning: classified.hookWarning,
                    stderr,
                });
            });
            child.on('error', (error) => {
                resolve({
                    success: false,
                    output: '',
                    error: error.message,
                    stderr: '',
                });
            });
        }
        catch (error) {
            resolve({
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                stderr: '',
            });
        }
    });
}
/**
 * 检测是否为可重试的 API 错误
 * 统一的 API 重试判断逻辑，供所有 Harness 阶段共用
 *
 * 重试条件: HTTP 429, 500, 网络超时, 进程异常退出
 */
export function isRetryableError(output, stderr) {
    const combinedOutput = `${output} ${stderr}`;
    // 429 Rate Limit
    const rateLimitMatch = combinedOutput.match(/API Error:\s*429.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (rateLimitMatch) {
        const resetTime = new Date(rateLimitMatch[1]);
        const now = new Date();
        const waitSeconds = Math.max(60, Math.ceil((resetTime.getTime() - now.getTime()) / 1000));
        return { retryable: true, waitSeconds, reason: 'API 速率限制 (429)' };
    }
    // 500 Server Error
    if (combinedOutput.includes('API Error: 500') || combinedOutput.includes('"code":"500"')) {
        return { retryable: true, waitSeconds: 30, reason: 'API 服务器错误 (500)' };
    }
    // Network/Connection errors
    if (combinedOutput.includes('ECONNRESET') ||
        combinedOutput.includes('ETIMEDOUT') ||
        combinedOutput.includes('ENOTFOUND') ||
        combinedOutput.includes('network error')) {
        return { retryable: true, waitSeconds: 10, reason: '网络连接错误' };
    }
    return { retryable: false };
}
/**
 * 延迟函数（秒）
 */
export function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
/**
 * 运行 Headless Claude（带 API 级重试机制）
 *
 * 统一的重试封装，供 Code Review / QA / Evaluation 等阶段共用。
 * 重试条件: HTTP 429, 500, 网络超时, 进程异常退出
 */
export async function runHeadlessClaudeWithRetry(options, retryConfig) {
    const maxAttempts = retryConfig.maxAttempts + 1; // +1 因为第一次不算重试
    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
            console.log(`   🔄 API 调用重试 (${attempt - 1}/${retryConfig.maxAttempts})...`);
        }
        lastResult = await runHeadlessClaude(options);
        if (lastResult.success) {
            return lastResult;
        }
        // 检查是否为可重试错误
        const errorInfo = isRetryableError(lastResult.output, lastResult.error || '');
        if (!errorInfo.retryable || attempt >= maxAttempts) {
            return lastResult;
        }
        // 计算退避延迟（指数退避）
        const delay = Math.min(errorInfo.waitSeconds || retryConfig.baseDelay, retryConfig.baseDelay * Math.pow(2, attempt - 1));
        console.log(`   ⏳ ${errorInfo.reason}，${delay} 秒后重试...`);
        await sleep(delay);
    }
    return lastResult;
}
/**
 * 归档已存在的报告文件
 *
 * 在重试场景中，报告文件可能已存在。此函数将旧报告复制到 archive/ 子目录，
 * 保留历史记录用于事后根因分析。
 *
 * 归档路径格式: {报告目录}/archive/{ISO-timestamp}-{原始文件名}
 */
export function archiveReportIfExists(reportPath) {
    try {
        if (!fs.existsSync(reportPath)) {
            return;
        }
        const dir = path.dirname(reportPath);
        const filename = path.basename(reportPath);
        const archiveDir = path.join(dir, 'archive');
        if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archivePath = path.join(archiveDir, `${timestamp}-${filename}`);
        fs.copyFileSync(reportPath, archivePath);
        console.log(`   📦 已归档旧报告: archive/${timestamp}-${filename}`);
    }
    catch (error) {
        // 归档失败不阻断报告写入流程
        console.warn(`   ⚠️ 归档报告失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function saveReport(reportPath, content) {
    const dir = path.dirname(reportPath);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        archiveReportIfExists(reportPath);
        fs.writeFileSync(reportPath, content, 'utf-8');
    }
    catch (error) {
        throw new Error(`保存报告失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export function filterCheckpoints(task, filterFn) {
    if (!task.checkpoints) {
        return [];
    }
    return task.checkpoints.filter(filterFn);
}
/**
 * 按三级优先级匹配结构化评估结果
 *
 * Level 1: EVALUATION_RESULT: PASS/NOPASS 行（强制格式）
 * Level 2: Markdown 标题格式（向后兼容: ## 评估结果: PASS 等）
 * Level 3: PASS/NOPASS 关键词（首次出现）
 *
 * 替代中文情感判断，避免技术文档中高频词导致假 PASS
 */
export function parseStructuredResult(output) {
    if (!output || output.trim().length === 0) {
        return { passed: null, matchLevel: null };
    }
    // Level 1: 结构化标记行（强制格式）
    // 匹配 EVALUATION_RESULT: PASS/NOPASS 和 VERDICT: PASS/NOPASS
    const level1 = output.match(/(?:EVALUATION_RESULT|VERDICT)\s*[:：]\s*(PASS|NOPASS)/i);
    if (level1) {
        return { passed: level1[1].toUpperCase() === 'PASS', matchLevel: 1 };
    }
    // Level 2: Markdown 标题格式（向后兼容）
    const level2Patterns = [
        /##\s*(?:评估结果|审核结果|验证结果|Evaluation Result|Result|Verdict)\s*[:：]?\s*(PASS|NOPASS)/i,
        /(?:评估结果|审核结果|验证结果|Evaluation Result|Result|Verdict)[:：]?\s*(PASS|NOPASS)/i,
        /"result"\s*[:：]\s*"(PASS|NOPASS)"/i,
    ];
    for (const pattern of level2Patterns) {
        const match = output.match(pattern);
        if (match) {
            return { passed: match[1].toUpperCase() === 'PASS', matchLevel: 2 };
        }
    }
    // Level 3: PASS/NOPASS 关键词（首次出现）
    const level3 = output.match(/\b(PASS|NOPASS)\b/i);
    if (level3) {
        return { passed: level3[1].toUpperCase() === 'PASS', matchLevel: 3 };
    }
    return { passed: null, matchLevel: null };
}
export function parseVerdictResult(output, options) {
    const result = {
        passed: true,
        reason: '',
        items: [],
        failedCheckpoints: [],
        details: '',
    };
    const resultPattern = new RegExp(`##\\s*${options.resultField}\\s*[:：]\\s*(PASS|NOPASS)`, 'i');
    const resultMatch = output.match(resultPattern);
    if (resultMatch) {
        result.passed = resultMatch[1].toUpperCase() === 'PASS';
    }
    const reasonPattern = new RegExp(`##\\s*${options.reasonField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
    const reasonMatch = output.match(reasonPattern);
    if (reasonMatch) {
        result.reason = reasonMatch[1].trim();
    }
    const listPattern = new RegExp(`##\\s*${options.listField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
    const listMatch = output.match(listPattern);
    if (listMatch) {
        const listText = listMatch[1].trim();
        if (listText && listText !== '无' && listText !== 'N/A') {
            result.items = listText.split('\n')
                .map(line => line.replace(/^[-*]\s*/, '').trim())
                .filter(line => line.length > 0);
        }
    }
    const checkpointPattern = new RegExp(`##\\s*${options.checkpointField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
    const checkpointMatch = output.match(checkpointPattern);
    if (checkpointMatch) {
        const checkpointText = checkpointMatch[1].trim();
        if (checkpointText && checkpointText !== '无' && checkpointText !== 'N/A') {
            result.failedCheckpoints = checkpointText.split('\n')
                .map(line => line.replace(/^[-*]\s*/, '').trim())
                .filter(line => line.length > 0);
        }
    }
    if (options.detailsField) {
        const detailsPattern = new RegExp(`##\\s*${options.detailsField}\\s*[:：]\\s*(.+?)(?=##|$)`, 'si');
        const detailsMatch = output.match(detailsPattern);
        if (detailsMatch) {
            result.details = detailsMatch[1].trim();
        }
    }
    // 结构化格式未匹配时，使用三级优先级关键词匹配（替代中文情感判断）
    if (!resultMatch) {
        const structured = parseStructuredResult(output);
        if (structured.passed !== null) {
            result.passed = structured.passed;
            if (!result.reason) {
                // 尝试从 REASON/EVALUATION_REASON/原因 字段提取原因
                const reasonPatterns = [
                    /REASON\s*[:：]\s*(.+?)(?=\n\n|\n## |$)/si,
                    /EVALUATION_REASON\s*[:：]\s*(.+?)(?=\n\n|\n## |$)/si,
                    new RegExp(`##?\s*${options.reasonField}\s*[:：]?\s*(.+?)(?=\n\n|\n## |$)`, 'si'),
                ];
                for (const pattern of reasonPatterns) {
                    const match = output.match(pattern);
                    if (match && match[1]?.trim()) {
                        result.reason = match[1].trim();
                        break;
                    }
                }
                // 如果仍然找不到原因，使用默认消息
                if (!result.reason) {
                    result.reason = `基于结构化关键词匹配（级别 ${structured.matchLevel}）`;
                }
            }
        }
    }
    if (!result.reason) {
        result.reason = '无法解析判定结果';
    }
    return result;
}
export function getReportDir(taskId, cwd) {
    return path.join(getProjectDir(cwd), 'reports', 'harness', taskId);
}
export function getReportPath(taskId, reportType, cwd) {
    return path.join(getReportDir(taskId, cwd), `${reportType}-report.md`);
}
/**
 * 从报告文件中提取列表项（支持 "无" / "N/A" / "(无)" 等空值标记）
 */
function extractListItems(text) {
    if (!text)
        return [];
    const trimmed = text.trim();
    if (!trimmed || /^(无|N\/A|\(无\)|\s*- \(无\)\s*)$/i.test(trimmed))
        return [];
    return trimmed.split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0 && line !== '(无)');
}
/**
 * CP-1: 从 dev-report.md 提取状态(status)、耗时(duration)、证据文件(evidence)
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseDevReport(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim())
            return null;
        // 提取 taskId（标题行）
        const titleMatch = content.match(/^#\s*开发报告\s*[-–—]\s*(.+?)\s*$/m);
        const taskId = titleMatch?.[1]?.trim() || '';
        // 提取状态
        const statusMatch = content.match(/\*\*状态\*\*\s*[:：]\s*(.+?)\s*$/m);
        const status = statusMatch?.[1]?.trim() || 'unknown';
        // 提取耗时
        const durationMatch = content.match(/\*\*耗时\*\*\s*[:：]\s*([\d.]+)\s*s/m);
        const duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;
        // 提取时间
        const startTimeMatch = content.match(/\*\*开始时间\*\*\s*[:：]\s*(.+?)\s*$/m);
        const endTimeMatch = content.match(/\*\*结束时间\*\*\s*[:：]\s*(.+?)\s*$/m);
        // 提取证据文件
        const evidenceMatch = content.match(/##\s*证据文件\s*[:：]?\s*\n([\s\S]*?)(?=\n##|\n```|$)/i);
        const evidence = extractListItems(evidenceMatch?.[1]);
        // 提取完成的检查点
        const checkpointsMatch = content.match(/##\s*完成的检查点\s*[:：]?\s*\n([\s\S]*?)(?=\n##|\n```|$)/i);
        const checkpointsCompleted = extractListItems(checkpointsMatch?.[1]);
        // 提取错误信息
        const errorMatch = content.match(/##\s*错误信息\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
        const error = errorMatch?.[1]?.trim() || undefined;
        return {
            taskId,
            status,
            duration,
            evidence,
            checkpointsCompleted,
            startTime: startTimeMatch?.[1]?.trim() || '',
            endTime: endTimeMatch?.[1]?.trim() || '',
            error,
        };
    }
    catch {
        return null;
    }
}
/**
 * CP-2: 从 code-review-report.md 提取 PASS/NOPASS 结果和原因
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseCodeReviewReport(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim())
            return null;
        return parseVerdictReportContent(content, 'code_review');
    }
    catch {
        return null;
    }
}
/**
 * CP-3: 从 qa-report.md 提取 PASS/NOPASS 结果和原因
 *
 * 解析失败时返回 null，调用方负责降级处理
 */
export function parseQAReport(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim())
            return null;
        return parseVerdictReportContent(content, 'qa');
    }
    catch {
        return null;
    }
}
/**
 * 共用的审核报告内容解析逻辑
 */
function parseVerdictReportContent(content, _source) {
    // 提取 taskId（标题行）
    const titleMatch = content.match(/^#\s*(?:代码审核|QA\s*验证)\s*报告\s*[-–—]\s*(.+?)\s*$/m);
    const taskId = titleMatch?.[1]?.trim() || '';
    // 提取结果：**结果**: ✅ PASS / ❌ NOPASS
    const resultMatch = content.match(/\*\*结果\*\*\s*[:：]\s*(?:✅|❌)?\s*(PASS|NOPASS)/i);
    if (!resultMatch)
        return null;
    const result = resultMatch[1].toUpperCase();
    // 提取原因
    const reasonMatch = content.match(/##\s*原因\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
    const reason = reasonMatch?.[1]?.trim() || '';
    // 提取未通过的检查点
    const failedCpMatch = content.match(/##\s*未通过的检查点\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
    const failedCheckpoints = extractListItems(failedCpMatch?.[1]);
    // 提取详细反馈
    const detailsMatch = content.match(/##\s*详细反馈\s*[:：]?\s*\n([\s\S]*?)(?=\n##|$)/i);
    const details = detailsMatch?.[1]?.trim() || undefined;
    return {
        taskId,
        result,
        reason,
        failedCheckpoints,
        details,
    };
}
/**
 * CP-4: 根据目标阶段，从报告文件重建前置数据
 *
 * 阶段依赖关系：
 * - development: 无前置（从头开始）
 * - code_review: 需要 dev-report
 * - qa: 需要 dev-report + code-review-report
 * - evaluation: 需要 dev-report + code-review-report + qa-report
 *
 * 解析失败时返回 null，调用方负责降级处理（降级为从 development 重新开始）
 */
export function rebuildPrerequisiteData(taskId, phase, cwd) {
    try {
        const reportDir = getReportDir(taskId, cwd);
        // development 阶段不需要前置数据
        if (phase === 'development') {
            return { devReport: null, codeReviewVerdict: null, qaVerdict: null };
        }
        // 始终需要 dev-report（除 development 外的所有阶段）
        const devReport = parseDevReport(path.join(reportDir, 'dev-report.md'));
        if (!devReport)
            return null;
        // code_review 阶段只需要 dev-report
        if (phase === 'code_review') {
            return { devReport, codeReviewVerdict: null, qaVerdict: null };
        }
        // qa / qa_verification 阶段还需要 code-review-report
        if (phase === 'qa' || phase === 'qa_verification') {
            const codeReviewVerdict = parseCodeReviewReport(path.join(reportDir, 'code-review-report.md'));
            if (!codeReviewVerdict)
                return null;
            return { devReport, codeReviewVerdict, qaVerdict: null };
        }
        // evaluation 阶段还需要 code-review-report + qa-report
        if (phase === 'evaluation') {
            const codeReviewVerdict = parseCodeReviewReport(path.join(reportDir, 'code-review-report.md'));
            if (!codeReviewVerdict)
                return null;
            const qaVerdict = parseQAReport(path.join(reportDir, 'qa-report.md'));
            if (!qaVerdict)
                return null;
            return { devReport, codeReviewVerdict, qaVerdict };
        }
        // 未知阶段，返回 null 触发降级
        return null;
    }
    catch {
        return null;
    }
}
