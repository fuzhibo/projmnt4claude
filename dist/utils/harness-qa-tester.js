/**
 * HarnessQATester - QA 验证阶段处理器
 *
 * 负责执行 QA 验证检查点：
 * - 运行单元测试
 * - 运行功能测试
 * - 运行集成测试
 * - 判断是否需要人工验证
 */
import * as path from 'path';
import { validateCheckpointVerification } from '../types/task.js';
import { saveReport, filterCheckpoints, parseVerdictResult, getReportPath, REVIEW_TIMEOUT_RATIO, } from './harness-helpers.js';
import { getAgent, buildEffectiveTools } from './headless-agent.js';
import { getQARoleTemplate } from './role-prompts.js';
import { generateFallbackVerification } from './checkpoint.js';
import { detectContradiction } from './contradiction-detector.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { qaVerdictResultMarker, qaVerdictHasReason } from './validation-rules/verdict-rules.js';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
/**
 * 验证检查点的验证信息完整性
 * 用于 QA 提示词中显示警告
 */
function checkCheckpointVerification(cp) {
    return validateCheckpointVerification(cp);
}
export class HarnessQATester {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * 执行 QA 验证
     */
    async verify(task, codeReviewVerdict, retryContext) {
        console.log(`\n🧪 QA 验证阶段...`);
        console.log(`   任务: ${task.title}`);
        const verdict = {
            taskId: task.id,
            result: 'PASS',
            reason: '',
            testFailures: [],
            failedCheckpoints: [],
            requiresHuman: false,
            humanVerificationCheckpoints: [],
            verifiedAt: new Date().toISOString(),
            verifiedBy: 'qa_tester',
        };
        // 如果代码审核未通过，直接返回 NOPASS
        if (codeReviewVerdict.result !== 'PASS') {
            verdict.result = 'NOPASS';
            verdict.reason = `代码审核未通过，跳过 QA 验证: ${codeReviewVerdict.reason}`;
            await this.saveReport(task.id, verdict);
            return verdict;
        }
        try {
            // 1. 获取 QA 验证类检查点
            const qaCheckpoints = this.getQACheckpoints(task);
            console.log(`   📋 QA 验证检查点: ${qaCheckpoints.length} 个`);
            if (qaCheckpoints.length === 0) {
                // 没有 QA 检查点，直接通过
                verdict.result = 'PASS';
                verdict.reason = '无 QA 验证检查点，自动通过';
                console.log('   ✅ 无 QA 验证检查点，自动通过');
            }
            else {
                // 2. 检查是否有人工验证检查点
                const humanCheckpoints = qaCheckpoints.filter(cp => cp.requiresHuman === true);
                verdict.humanVerificationCheckpoints = humanCheckpoints.map(cp => cp.id);
                // 3. 运行自动化 QA 验证
                const qaResult = await this.runQAVerification(task, codeReviewVerdict, qaCheckpoints, retryContext);
                verdict.result = qaResult.passed ? 'PASS' : 'NOPASS';
                verdict.reason = qaResult.reason;
                verdict.testFailures = qaResult.failures;
                verdict.failedCheckpoints = qaResult.failedCheckpoints;
                verdict.details = qaResult.details;
                // IR-08-05: 矛盾检测 — 当结果标签与内容矛盾时自动修正
                const contradiction = detectContradiction(verdict.result, verdict.reason || '');
                if (contradiction.hasContradiction && contradiction.correctedResult) {
                    console.log(`   ⚠️  矛盾检测: ${contradiction.reason}`);
                    verdict.result = contradiction.correctedResult;
                    verdict.reason += ` [矛盾修正: ${contradiction.reason}]`;
                }
                // 4. 标记需要人工验证的检查点（仅信息标记，不影响 PASS/NOPASS 判定）
                if (humanCheckpoints.length > 0) {
                    verdict.requiresHuman = true;
                    // 注意: requiresHuman 仅作为信息标记，reason 不附加人工检查点信息
                    // 人工检查点信息通过 requiresHuman + humanVerificationCheckpoints 字段传递
                    const deferredInfo = `${humanCheckpoints.length} 个检查点已延期（deferred），等待人工验证: ${humanCheckpoints.map(cp => cp.id).join(', ')}`;
                    verdict.details = verdict.details ? `${verdict.details}\n${deferredInfo}` : deferredInfo;
                    console.log(`\n   ⏳ ${deferredInfo}`);
                }
                if (verdict.result === 'PASS' && !verdict.requiresHuman) {
                    console.log('\n   ✅ QA 验证通过');
                }
                else if (verdict.result === 'PASS' && verdict.requiresHuman) {
                    console.log('\n   ⏳ 自动化验证通过，等待人工验证');
                }
                else {
                    console.log(`\n   ❌ QA 验证未通过: ${verdict.reason}`);
                }
            }
        }
        catch (error) {
            verdict.result = 'NOPASS';
            verdict.reason = `QA 验证过程出错: ${error instanceof Error ? error.message : String(error)}`;
            console.log(`\n   ❌ QA 验证出错: ${verdict.reason}`);
        }
        // 保存 QA 报告
        await this.saveReport(task.id, verdict);
        return verdict;
    }
    /**
     * 获取 QA 验证类检查点
     */
    getQACheckpoints(task) {
        return filterCheckpoints(task, cp => cp.category === 'qa_verification' ||
            cp.verification?.method === 'unit_test' ||
            cp.verification?.method === 'functional_test' ||
            cp.verification?.method === 'integration_test' ||
            cp.verification?.method === 'e2e_test' ||
            cp.verification?.method === 'automated' ||
            cp.requiresHuman === true);
    }
    /**
     * 运行 QA 验证
     */
    async runQAVerification(task, codeReviewVerdict, checkpoints, retryContext) {
        // 分离自动化检查点和人工验证检查点
        const automatedCheckpoints = checkpoints.filter(cp => !cp.requiresHuman);
        const humanCheckpoints = checkpoints.filter(cp => cp.requiresHuman === true);
        // BUG-013-2: 检查自动化检查点中是否有缺少验证命令的情况
        const checkpointsWithoutCommands = automatedCheckpoints.filter(cp => {
            const result = validateCheckpointVerification(cp);
            return !result.valid;
        });
        if (checkpointsWithoutCommands.length > 0) {
            console.log(`\n   ⚠️  ${checkpointsWithoutCommands.length} 个自动化检查点缺少验证命令:`);
            for (const cp of checkpointsWithoutCommands) {
                const result = validateCheckpointVerification(cp);
                console.log(`      - [${cp.id}] ${result.warning || '缺少 commands/steps'}`);
            }
            console.log('      这些检查点将依赖 AI 自由验证，可能影响验证质量。');
        }
        if (automatedCheckpoints.length === 0) {
            // 只有需要人工验证的检查点，自动化 QA 自动通过
            // BUG-014-2B: reason 不包含"需要人工验证"字样，避免误导下游评估者
            return {
                passed: true,
                reason: '无自动化 QA 检查点，自动化验证自动通过',
                failures: [],
                failedCheckpoints: [],
            };
        }
        // 构建验证提示词
        const prompt = this.buildQAPrompt(task, codeReviewVerdict, automatedCheckpoints, retryContext);
        console.log('\n   📝 QA 验证提示词已生成');
        // 运行独立验证会话
        console.log('\n   🤖 启动 QA 验证会话...');
        const agent = getAgent(this.config.cwd);
        const effectiveTools = buildEffectiveTools('qaVerification', this.config.cwd, task);
        const invokeOptions = {
            allowedTools: effectiveTools.tools,
            timeout: Math.floor(this.config.timeout / REVIEW_TIMEOUT_RATIO),
            cwd: this.config.cwd,
            maxRetries: this.config.apiRetryAttempts,
            outputFormat: 'text',
            dangerouslySkipPermissions: effectiveTools.skipPermissions,
        };
        const engine = createSessionAwareEngine('markdown', [qaVerdictResultMarker, qaVerdictHasReason], 1);
        const engineResult = await engine.runWithFeedback(agent.invoke.bind(agent), prompt, invokeOptions);
        if (engineResult.retries > 0) {
            console.log(`   🔄 QA 验证结果格式不匹配，已重试 ${engineResult.retries} 次`);
        }
        if (!engineResult.result.success) {
            return {
                passed: false,
                reason: `QA 验证会话失败: ${engineResult.result.error || '未知错误'}`,
                failures: [],
                failedCheckpoints: [],
            };
        }
        // 验证规则未通过（如缺少 VERDICT 标记），直接返回 NOPASS 避免解析失败
        if (!engineResult.passed) {
            const violationMessages = engineResult.violations
                .map((v) => `${v.ruleId}: ${v.message}`)
                .join('; ');
            console.log(`   ⚠️  QA 验证输出格式验证未通过: ${violationMessages}`);
            // 尝试从原始输出中提取可用信息
            const rawOutput = engineResult.result.output || '';
            const parsed = this.parseQAResult(rawOutput);
            // 如果解析到了有效结果（非默认原因），使用解析结果
            if (parsed.reason && parsed.reason !== '无法解析判定结果') {
                return parsed;
            }
            return {
                passed: false,
                reason: `QA 验证输出格式不符合要求: ${violationMessages}`,
                failures: [],
                failedCheckpoints: [],
            };
        }
        // 解析验证结果
        return this.parseQAResult(engineResult.result.output || '');
    }
    /**
     * 构建 QA 验证提示词
     */
    buildQAPrompt(task, codeReviewVerdict, checkpoints, retryContext) {
        const roleTemplate = getQARoleTemplate(task.recommendedRole);
        // Build retry context section
        let retryContextSection = '';
        if (retryContext?.previousFailureReason) {
            retryContextSection = [
                '## 前次验证失败原因',
                '',
                '上一次 QA 验证未通过，失败原因如下：',
                '',
                `> ${retryContext.previousFailureReason}`,
                '',
                '请特别注意：',
                '- 仔细审视前次失败原因是否构成真正的功能缺陷（参考上述验证原则）',
                '- 如果前次判定是基于形式要求而非功能缺陷，本次应修正判定为 PASS',
                '- 如果前次失败原因仍然存在且确属功能问题，继续保持 NOPASS',
                '',
            ].join('\n');
        }
        const descriptionSection = task.description
            ? `## 任务描述\n${task.description}`
            : '';
        // Build checkpoints list with verification details
        const checkpointsList = checkpoints.map((cp, i) => {
            const lines = [`${i + 1}. [${cp.id}] ${cp.description}`];
            if (cp.verification?.commands && cp.verification.commands.length > 0) {
                lines.push(`   验证命令: ${cp.verification.commands.join(', ')}`);
            }
            else if (cp.verification?.steps && cp.verification.steps.length > 0) {
                lines.push(`   验证步骤: ${cp.verification.steps.join('；')}`);
            }
            else {
                const fallback = generateFallbackVerification(cp.description, task);
                if (fallback.steps && fallback.steps.length > 0) {
                    lines.push(`   建议验证步骤: ${fallback.steps.join('；')}`);
                }
                if (fallback.commands && fallback.commands.length > 0) {
                    lines.push(`   回退验证命令: ${fallback.commands.join(', ')}`);
                }
            }
            if (cp.verification?.expected) {
                lines.push(`   期望结果: ${cp.verification.expected}`);
            }
            const cpValidation = validateCheckpointVerification(cp);
            if (!cpValidation.valid && cpValidation.warning) {
                lines.push(`   ⚠️ ${cpValidation.warning}`);
            }
            return lines.join('\n');
        }).join('\n');
        const testStrategy = roleTemplate.testStrategy.map((strategy, i) => `${i + 1}. ${strategy}`).join('\n');
        const template = loadPromptTemplate('qa', this.config.cwd);
        return resolveTemplate(template, {
            roleDeclaration: roleTemplate.roleDeclaration,
            taskId: task.id,
            title: task.title,
            descriptionSection,
            checkpointsList,
            codeReviewResult: codeReviewVerdict.result,
            codeReviewReason: codeReviewVerdict.reason,
            testStrategy,
            retryContextSection,
        }).replace(/\n{3,}/g, '\n\n');
    }
    /**
     * 解析 QA 验证结果
     */
    parseQAResult(output) {
        const parsed = parseVerdictResult(output, {
            resultField: '验证结果',
            reasonField: '原因',
            listField: '测试失败',
            checkpointField: '未通过的检查点',
            detailsField: '详细反馈',
        });
        return {
            passed: parsed.passed,
            reason: parsed.reason,
            failures: parsed.items,
            failedCheckpoints: parsed.failedCheckpoints,
            details: parsed.details,
        };
    }
    /**
     * 保存 QA 报告
     */
    async saveReport(taskId, verdict) {
        const reportPath = getReportPath(taskId, 'qa', this.config.cwd);
        const content = this.formatReport(verdict);
        await saveReport(reportPath, content);
    }
    /**
     * 格式化 QA 报告
     */
    formatReport(verdict) {
        const lines = [
            `# QA 验证报告 - ${verdict.taskId}`,
            '',
            `**结果**: ${verdict.result === 'PASS' ? '✅ PASS' : '❌ NOPASS'}`,
            `**验证时间**: ${verdict.verifiedAt}`,
            `**验证者**: ${verdict.verifiedBy}`,
            `**需要人工验证**: ${verdict.requiresHuman ? '是' : '否'}`,
            '',
            '## 原因',
            verdict.reason,
            '',
        ];
        if (verdict.testFailures.length > 0) {
            lines.push('## 测试失败');
            verdict.testFailures.forEach(failure => {
                lines.push(`- ${failure}`);
            });
            lines.push('');
        }
        if (verdict.failedCheckpoints.length > 0) {
            lines.push('## 未通过的检查点');
            verdict.failedCheckpoints.forEach(checkpoint => {
                lines.push(`- ${checkpoint}`);
            });
            lines.push('');
        }
        if (verdict.humanVerificationCheckpoints.length > 0) {
            lines.push('## 已延期（deferred）的检查点 - 等待人工验证');
            lines.push('*这些检查点不参与 PASS/NOPASS 判定，仅等待人工后处理*');
            verdict.humanVerificationCheckpoints.forEach(checkpoint => {
                lines.push(`- ${checkpoint} [deferred]`);
            });
            lines.push('');
        }
        if (verdict.details) {
            lines.push('## 详细反馈');
            lines.push(verdict.details);
            lines.push('');
        }
        return lines.join('\n');
    }
}
