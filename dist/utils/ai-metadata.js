/**
 * AI 元数据助手模块
 *
 * 共享 AI 元数据提取能力，基于 HeadlessAgent 接口实现。
 * 支持需求增强、检查点生成、质量评估、重复检测等功能。
 *
 * 设计原则:
 * - 单次调用 ~500-1000 tokens，~10-15 秒
 * - 严格输出验证: JSON schema 校验 + 失败自动重试 (最多 2 次)
 * - 超时 30 秒/次，Claude 不可用时回退到规则引擎
 * - 只输出 JSON，不要 markdown 代码块包裹
 * - 如果无法判断某个字段，设为 null 而非猜测
 */
import { Logger } from './logger.js';
import { getAgent } from './headless-agent.js';
import { inferTaskType, inferTaskPriority } from '../types/task';
import { loadPromptTemplate, resolveTemplate } from './prompt-templates.js';
import { createSessionAwareEngine } from './feedback-constraint-engine.js';
import { requirementOutputRules, qualityOutputRules, duplicatesOutputRules, stalenessOutputRules, bugReportOutputRules, } from './validation-rules/ai-metadata-rules.js';
import { semanticDependencyOutputRules } from './validation-rules/plan-rules.js';
/**
 * 层级定义与描述
 */
export const LAYER_DEFINITIONS = {
    Layer0: {
        label: '类型定义层',
        description: '基础类型、接口、枚举定义，被所有上层模块依赖',
        pathPatterns: ['src/types/', 'src/interfaces/', 'src/schemas/'],
    },
    Layer1: {
        label: '工具函数层',
        description: '纯函数工具、辅助模块，依赖类型层但不依赖命令层',
        pathPatterns: ['src/utils/', 'src/helpers/', 'src/lib/'],
    },
    Layer2: {
        label: '核心逻辑层',
        description: '核心业务逻辑、数据处理，依赖工具层和类型层',
        pathPatterns: ['src/core/', 'src/services/', 'src/processors/'],
    },
    Layer3: {
        label: '命令/入口层',
        description: 'CLI 命令、入口文件，依赖所有下层模块',
        pathPatterns: ['src/commands/', 'src/index.ts', 'src/cli/'],
    },
};
/**
 * 根据文件路径推断所属架构层级
 */
export function classifyFileToLayer(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    // 从高依赖层（Layer3）到低依赖层（Layer0）匹配
    if (normalized.includes('src/commands/') || normalized.includes('src/cli/') || normalized.endsWith('src/index.ts')) {
        return 'Layer3';
    }
    if (normalized.includes('src/core/') || normalized.includes('src/services/') || normalized.includes('src/processors/')) {
        return 'Layer2';
    }
    if (normalized.includes('src/utils/') || normalized.includes('src/helpers/') || normalized.includes('src/lib/')) {
        return 'Layer1';
    }
    if (normalized.includes('src/types/') || normalized.includes('src/interfaces/') || normalized.includes('src/schemas/')) {
        return 'Layer0';
    }
    // 默认归为工具层
    return 'Layer1';
}
/**
 * 对文件列表按架构层级排序（Layer0 → Layer3）
 */
export function sortFilesByLayer(files) {
    const layerOrder = { Layer0: 0, Layer1: 1, Layer2: 2, Layer3: 3 };
    return [...files].sort((a, b) => layerOrder[classifyFileToLayer(a)] - layerOrder[classifyFileToLayer(b)]);
}
/**
 * 将文件列表按层级分组
 */
export function groupFilesByLayer(files) {
    const groups = new Map();
    for (const file of files) {
        const layer = classifyFileToLayer(file);
        if (!groups.has(layer))
            groups.set(layer, []);
        groups.get(layer).push(file);
    }
    // 按层级排序
    const sorted = new Map();
    const order = ['Layer0', 'Layer1', 'Layer2', 'Layer3'];
    for (const layer of order) {
        if (groups.has(layer)) {
            sorted.set(layer, groups.get(layer));
        }
    }
    return sorted;
}
// ============================================================
// JSON Schema 定义
// ============================================================
const REQUIREMENT_SCHEMA = {
    type: 'object',
    required: ['title', 'description', 'type', 'priority', 'checkpoints'],
    properties: {
        title: { type: 'string', minLength: 10, maxLength: 50 },
        description: { type: 'string' },
        type: { enum: ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null] },
        priority: { enum: ['P0', 'P1', 'P2', 'P3', null] },
        recommendedRole: { type: ['string', 'null'] },
        checkpoints: {
            type: 'array',
            items: { type: 'string', minLength: 5 },
        },
        dependencies: {
            type: ['array', 'null'],
            items: { type: 'string' },
        },
    },
};
const CHECKPOINTS_SCHEMA = {
    type: 'object',
    required: ['checkpoints'],
    properties: {
        checkpoints: {
            type: 'array',
            items: { type: 'string', minLength: 5 },
        },
    },
};
const QUALITY_SCHEMA = {
    type: 'object',
    required: ['score', 'issues', 'suggestions'],
    properties: {
        score: { type: 'number', minimum: 0, maximum: 100 },
        issues: {
            type: 'array',
            items: {
                type: 'object',
                required: ['field', 'severity', 'message'],
                properties: {
                    field: { type: 'string' },
                    severity: { enum: ['error', 'warning', 'info'] },
                    message: { type: 'string' },
                },
            },
        },
        suggestions: {
            type: 'array',
            items: { type: 'string' },
        },
    },
};
const DUPLICATES_SCHEMA = {
    type: 'object',
    required: ['duplicates'],
    properties: {
        duplicates: {
            type: 'array',
            items: {
                type: 'object',
                required: ['taskIds', 'similarity'],
                properties: {
                    taskIds: { type: 'array', items: { type: 'string' } },
                    similarity: { type: 'number', minimum: 0, maximum: 1 },
                    keepTaskId: { type: ['string', 'null'] },
                    reason: { type: ['string', 'null'] },
                },
            },
        },
    },
};
const STALENESS_SCHEMA = {
    type: 'object',
    required: ['isStale', 'stalenessScore', 'suggestedAction', 'reason'],
    properties: {
        isStale: { type: 'boolean' },
        stalenessScore: { type: 'number', minimum: 0, maximum: 1 },
        suggestedAction: { enum: ['keep', 'close', 'update', 'split'] },
        reason: { type: 'string' },
    },
};
const BUG_REPORT_SCHEMA = {
    type: 'object',
    required: ['title', 'description', 'checkpoints'],
    properties: {
        title: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        type: { enum: ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null] },
        priority: { enum: ['P0', 'P1', 'P2', 'P3', null] },
        checkpoints: {
            type: ['array', 'null'],
            items: { type: 'string' },
        },
        rootCause: { type: ['string', 'null'] },
        impactScope: { type: ['string', 'null'] },
    },
};
const SEMANTIC_DEPS_SCHEMA = {
    type: 'object',
    required: ['dependencies'],
    properties: {
        dependencies: {
            type: 'array',
            items: {
                type: 'object',
                required: ['taskId', 'depTaskId', 'reason'],
                properties: {
                    taskId: { type: 'string' },
                    depTaskId: { type: 'string' },
                    reason: { type: 'string' },
                },
            },
        },
    },
};
const SEMANTIC_DEP_SCHEMA = {
    type: 'object',
    required: ['dependencies'],
    properties: {
        dependencies: {
            type: 'array',
            items: {
                type: 'object',
                required: ['taskId', 'depTaskId', 'reason'],
                properties: {
                    taskId: { type: 'string' },
                    depTaskId: { type: 'string' },
                    reason: { type: 'string' },
                },
            },
        },
    },
};
// ============================================================
// 有效的枚举值
// ============================================================
const VALID_TYPES = ['bug', 'feature', 'research', 'docs', 'refactor', 'test', null];
const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3', null];
const VALID_ACTIONS = ['keep', 'close', 'update', 'split'];
const VALID_SEVERITIES = ['error', 'warning', 'info'];
// ============================================================
// AIMetadataAssistant 类
// ============================================================
export class AIMetadataAssistant {
    logger;
    constructor(cwd) {
        this.logger = new Logger({ component: 'ai-metadata', cwd });
    }
    // ----------------------------------------------------------
    // CP-7: enhanceRequirement - 需求增强
    // ----------------------------------------------------------
    /**
     * 增强需求描述，返回完整的元数据
     * 单次调用返回: title, description, type, priority, checkpoints, dependencies
     */
    async enhanceRequirement(description, options) {
        const prompt = this.buildRequirementPrompt(description, undefined, options.cwd);
        const result = await this.invokeWithEngine(prompt, requirementOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 需求增强失败，回退到规则引擎');
            return this.fallbackEnhanceRequirement(description);
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed) {
            this.logger.warn('AI 输出 JSON 解析失败，回退到规则引擎');
            return this.fallbackEnhanceRequirement(description);
        }
        const validation = this.validateRequirement(parsed);
        if (!validation.valid) {
            this.logger.warn('AI 输出校验失败: ' + validation.errors.join(', '));
            return this.fallbackEnhanceRequirement(description);
        }
        return {
            title: this.sanitizeTitle(parsed.title),
            description: typeof parsed.description === 'string' ? parsed.description : null,
            type: VALID_TYPES.includes(parsed.type) ? parsed.type : null,
            priority: VALID_PRIORITIES.includes(parsed.priority) ? parsed.priority : null,
            recommendedRole: typeof parsed.recommendedRole === 'string' ? parsed.recommendedRole : null,
            checkpoints: this.sanitizeCheckpoints(parsed.checkpoints),
            dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : null,
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-8: enhanceCheckpoints - 检查点增强
    // ----------------------------------------------------------
    /**
     * 增强检查点列表
     * @param description - 任务描述
     * @param type - 任务类型
     * @param existing - 已有检查点
     */
    async enhanceCheckpoints(description, type, existing, options) {
        const prompt = this.buildCheckpointsPrompt(description, type, existing, options.cwd);
        const result = await this.invokeWithEngine(prompt, [], {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 检查点增强失败，回退到规则引擎');
            return { checkpoints: existing, aiUsed: false };
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed || !Array.isArray(parsed.checkpoints)) {
            this.logger.warn('AI 检查点输出解析失败，回退到已有检查点');
            return { checkpoints: existing, aiUsed: false };
        }
        return {
            checkpoints: this.sanitizeCheckpoints(parsed.checkpoints) ?? existing,
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-9: analyzeTaskQuality - 任务质量评估
    // ----------------------------------------------------------
    /**
     * 评估任务质量
     * @param task - 任务元数据
     */
    async analyzeTaskQuality(task, options) {
        const prompt = this.buildQualityPrompt(task, options.cwd);
        const result = await this.invokeWithEngine(prompt, qualityOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 质量评估失败，回退到规则引擎');
            return this.fallbackAnalyzeQuality(task);
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed) {
            return this.fallbackAnalyzeQuality(task);
        }
        return {
            score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50,
            issues: this.sanitizeIssues(parsed.issues),
            suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-10: detectDuplicates - 语义重复检测
    // ----------------------------------------------------------
    /**
     * 检测任务列表中的语义重复
     * @param tasks - 任务元数据列表
     */
    async detectDuplicates(tasks, options) {
        if (tasks.length < 2) {
            return { duplicates: [], aiUsed: false };
        }
        const prompt = this.buildDuplicatesPrompt(tasks, options.cwd);
        const result = await this.invokeWithEngine(prompt, duplicatesOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 重复检测失败，回退到规则引擎');
            return this.fallbackDetectDuplicates(tasks);
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed || !Array.isArray(parsed.duplicates)) {
            return this.fallbackDetectDuplicates(tasks);
        }
        return {
            duplicates: this.sanitizeDuplicates(parsed.duplicates, tasks),
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-11: assessStaleness - 陈旧任务评估
    // ----------------------------------------------------------
    /**
     * 评估任务是否陈旧以及建议动作
     * @param task - 任务元数据
     */
    async assessStaleness(task, options) {
        const prompt = this.buildStalenessPrompt(task, options.cwd);
        const result = await this.invokeWithEngine(prompt, stalenessOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 陈旧评估失败，回退到规则引擎');
            return this.fallbackAssessStaleness(task);
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed) {
            return this.fallbackAssessStaleness(task);
        }
        return {
            isStale: typeof parsed.isStale === 'boolean' ? parsed.isStale : false,
            stalenessScore: typeof parsed.stalenessScore === 'number' ? Math.max(0, Math.min(1, parsed.stalenessScore)) : 0,
            suggestedAction: VALID_ACTIONS.includes(parsed.suggestedAction) ? parsed.suggestedAction : 'keep',
            reason: typeof parsed.reason === 'string' ? parsed.reason : '',
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-12: analyzeBugReport - Bug 报告转需求
    // ----------------------------------------------------------
    /**
     * 将 Bug 报告转为需求文档
     * @param reportContent - Bug 报告内容
     * @param logContext - 可选的日志上下文
     */
    async analyzeBugReport(reportContent, logContext, options) {
        const prompt = this.buildBugReportPrompt(reportContent, logContext, options.cwd);
        const result = await this.invokeWithEngine(prompt, bugReportOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI Bug 报告分析失败，回退到规则引擎');
            return this.fallbackAnalyzeBugReport(reportContent);
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed) {
            return this.fallbackAnalyzeBugReport(reportContent);
        }
        return {
            title: this.sanitizeTitle(parsed.title),
            description: typeof parsed.description === 'string' ? parsed.description : null,
            type: VALID_TYPES.includes(parsed.type) ? parsed.type : 'bug',
            priority: VALID_PRIORITIES.includes(parsed.priority) ? parsed.priority : 'P2',
            checkpoints: this.sanitizeCheckpoints(parsed.checkpoints),
            rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : null,
            impactScope: typeof parsed.impactScope === 'string' ? parsed.impactScope : null,
            aiUsed: true,
        };
    }
    // ----------------------------------------------------------
    // CP-13: inferSemanticDependencies - AI 语义依赖推断
    // ----------------------------------------------------------
    /**
     * 通过 AI 分析任务描述的语义关系，推断任务间隐含的依赖关系
     *
     * @param tasks - 任务元数据列表
     * @param options - AI 调用选项
     * @returns 语义依赖推断结果
     */
    async inferSemanticDependencies(tasks, options) {
        if (tasks.length < 2) {
            return { dependencies: [], aiUsed: false };
        }
        const prompt = this.buildSemanticDependencyPrompt(tasks, options.cwd);
        const result = await this.invokeWithEngine(prompt, semanticDependencyOutputRules, {
            ...options,
            maxRetries: options.maxRetries ?? 2,
            timeoutSeconds: options.timeoutSeconds ?? 30,
        });
        if (!result.success) {
            this.logger.warn('AI 语义依赖推断失败');
            return { dependencies: [], aiUsed: false };
        }
        const parsed = this.parseJSON(result.output);
        if (!parsed || !Array.isArray(parsed.dependencies)) {
            this.logger.warn('AI 语义依赖输出解析失败');
            return { dependencies: [], aiUsed: false };
        }
        // 验证并清洗结果
        const validTaskIds = new Set(tasks.map(t => t.id));
        const deps = [];
        for (const dep of parsed.dependencies) {
            if (typeof dep === 'object' && dep !== null &&
                typeof dep.taskId === 'string' &&
                typeof dep.depTaskId === 'string' &&
                typeof dep.reason === 'string' &&
                validTaskIds.has(dep.taskId) &&
                validTaskIds.has(dep.depTaskId) &&
                dep.taskId !== dep.depTaskId) {
                deps.push({
                    taskId: dep.taskId,
                    depTaskId: dep.depTaskId,
                    reason: dep.reason,
                });
            }
        }
        return { dependencies: deps, aiUsed: true };
    }
    // ============================================================
    // Prompt 构建
    // ============================================================
    buildSemanticDependencyPrompt(tasks, cwd) {
        const taskList = tasks.slice(0, 50).map(t => `ID: ${t.id}\n标题: ${t.title}\n描述: ${(t.description || '').substring(0, 150)}`).join('\n---\n');
        const template = loadPromptTemplate('semanticDependency', cwd);
        return resolveTemplate(template, { taskList });
    }
    buildRequirementPrompt(description, errorFeedback, cwd) {
        const errorFeedbackSection = errorFeedback
            ? `\n\n## 上次输出错误\n${errorFeedback}\n请修正以上错误并重新输出。`
            : '';
        const template = loadPromptTemplate('requirement', cwd);
        return resolveTemplate(template, { description, errorFeedback: errorFeedbackSection });
    }
    buildCheckpointsPrompt(description, type, existing, cwd) {
        const existingCheckpointsSection = existing.length > 0
            ? `\n\n## 已有检查点\n${existing.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : '';
        const template = loadPromptTemplate('checkpoints', cwd);
        return resolveTemplate(template, {
            description,
            type: type || '未指定',
            existingCheckpointsSection,
        });
    }
    buildQualityPrompt(task, cwd) {
        const taskData = JSON.stringify({
            id: task.id,
            title: task.title,
            description: task.description,
            type: task.type,
            priority: task.priority,
            status: task.status,
            checkpoints: task.checkpoints?.map(c => c.description),
            dependencies: task.dependencies,
        }, null, 2);
        const template = loadPromptTemplate('quality', cwd);
        return resolveTemplate(template, { taskData });
    }
    buildDuplicatesPrompt(tasks, cwd) {
        const taskList = tasks.slice(0, 50).map(t => `ID: ${t.id}\n标题: ${t.title}\n描述: ${(t.description || '').substring(0, 200)}\n类型: ${t.type}`).join('\n---\n');
        const template = loadPromptTemplate('duplicates', cwd);
        return resolveTemplate(template, { taskList });
    }
    buildStalenessPrompt(task, cwd) {
        const ageMs = Date.now() - new Date(task.updatedAt).getTime();
        const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
        const taskData = JSON.stringify({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            type: task.type,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            ageDays,
            checkpointCount: task.checkpoints?.length ?? 0,
            completedCheckpoints: task.checkpoints?.filter(c => c.status === 'completed').length ?? 0,
        }, null, 2);
        const template = loadPromptTemplate('staleness', cwd);
        return resolveTemplate(template, { taskData });
    }
    buildBugReportPrompt(reportContent, logContext, cwd) {
        const logContextSection = logContext
            ? `\n## 日志上下文\n${logContext.substring(0, 2000)}`
            : '';
        const template = loadPromptTemplate('bugReport', cwd);
        return resolveTemplate(template, {
            reportContent: reportContent.substring(0, 4000),
            logContextSection,
        });
    }
    // ============================================================
    // 核心调用逻辑
    // ============================================================
    /**
     * 基于 FeedbackConstraintEngine 的 AI 调用
     *
     * 替代原先的手动重试循环，使用引擎进行：
     * - JSON 可解析性验证
     * - 非空输出检查
     * - 方法级业务规则验证（additionalRules）
     * - 结构化反馈生成与自动重试
     *
     * CP-3: 失败自动重试 (最多 maxRetries 次) + 错误反馈追加到 prompt
     * CP-5: 超时 30 秒/次
     *
     * @internal 用于需求分解等内部功能
     */
    async invokeWithEngine(prompt, additionalRules, options) {
        const { cwd, maxRetries, timeoutSeconds } = options;
        try {
            const agent = getAgent(cwd);
            const engine = createSessionAwareEngine('json', additionalRules, maxRetries);
            const invokeOptions = {
                timeout: timeoutSeconds,
                allowedTools: [],
                outputFormat: 'json',
                maxRetries: 0,
                cwd,
            };
            const engineResult = await engine.runWithFeedback(agent.invoke.bind(agent), prompt, invokeOptions);
            if (engineResult.retries > 0) {
                this.logger.debug(`FeedbackConstraintEngine 重试 ${engineResult.retries} 次`);
            }
            return engineResult.result;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.warn(`AI 调用异常: ${errorMsg}`);
            return {
                output: '',
                success: false,
                provider: 'none',
                durationMs: 0,
                tokensUsed: 0,
                model: '',
                error: errorMsg,
            };
        }
    }
    // ============================================================
    // JSON 解析与校验
    // ============================================================
    /**
     * 解析 JSON 字符串
     * CP-13: 只输出 JSON，不要 markdown 代码块包裹
     *
     * @internal 用于需求分解等内部功能
     */
    parseJSON(output) {
        if (!output || !output.trim())
            return null;
        let text = output.trim();
        // 去除可能的 markdown 代码块包裹
        const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
        if (codeBlockMatch) {
            text = codeBlockMatch[1].trim();
        }
        try {
            return JSON.parse(text);
        }
        catch {
            // 尝试提取 JSON 对象（可能前后有额外文本）
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                }
                catch {
                    return null;
                }
            }
            return null;
        }
    }
    /**
     * 校验需求增强结果
     */
    validateRequirement(parsed) {
        const errors = [];
        if (parsed.title !== null && typeof parsed.title !== 'string') {
            errors.push('title 必须是 string 或 null');
        }
        if (parsed.title !== null && typeof parsed.title === 'string') {
            if (parsed.title.length < 10 || parsed.title.length > 50) {
                errors.push(`title 长度 ${parsed.title.length} 不在 10-50 范围内`);
            }
        }
        if (!VALID_TYPES.includes(parsed.type)) {
            errors.push(`type "${parsed.type}" 不是有效值`);
        }
        if (!VALID_PRIORITIES.includes(parsed.priority)) {
            errors.push(`priority "${parsed.priority}" 不是有效值`);
        }
        if (!Array.isArray(parsed.checkpoints) && parsed.checkpoints !== null) {
            errors.push('checkpoints 必须是数组或 null');
        }
        return { valid: errors.length === 0, errors };
    }
    // ============================================================
    // 数据清洗
    // ============================================================
    /**
     * 清洗标题
     * CP-14: 动词开头，10-50 字符
     */
    sanitizeTitle(title) {
        if (typeof title !== 'string' || !title.trim())
            return null;
        let t = title.trim();
        // 截断到 50 字符
        if (t.length > 50)
            t = t.substring(0, 50);
        return t.length >= 10 ? t : null;
    }
    /**
     * 清洗检查点列表
     * CP-15: 每条动词开头，不能是泛泛的阶段名称
     */
    sanitizeCheckpoints(checkpoints) {
        if (!Array.isArray(checkpoints))
            return null;
        const genericPatterns = /^(?:开发阶段|测试阶段|设计阶段|评审阶段|部署阶段|实施阶段|开发|测试|设计|评审|部署|实施|完成)$/;
        const result = checkpoints
            .filter((c) => typeof c === 'string' && c.trim().length >= 5)
            .map(c => c.trim())
            .filter(c => !genericPatterns.test(c));
        return result.length > 0 ? result : null;
    }
    /**
     * 清洗质量问题列表
     */
    sanitizeIssues(issues) {
        if (!Array.isArray(issues))
            return [];
        return issues
            .filter((i) => typeof i === 'object' && i !== null)
            .filter(i => typeof i.field === 'string' && typeof i.message === 'string')
            .map(i => ({
            field: i.field,
            severity: VALID_SEVERITIES.includes(i.severity) ? i.severity : 'info',
            message: i.message,
        }));
    }
    /**
     * 清洗重复检测组
     */
    sanitizeDuplicates(duplicates, tasks) {
        const taskIds = new Set(tasks.map(t => t.id));
        return duplicates
            .filter((d) => typeof d === 'object' && d !== null)
            .filter(d => Array.isArray(d.taskIds) && d.taskIds.length >= 2)
            .filter(d => {
            const ids = d.taskIds.filter(id => taskIds.has(id));
            return ids.length >= 2;
        })
            .map(d => ({
            taskIds: d.taskIds.filter(id => taskIds.has(id)),
            similarity: typeof d.similarity === 'number' ? Math.max(0, Math.min(1, d.similarity)) : 0.7,
            keepTaskId: typeof d.keepTaskId === 'string' ? d.keepTaskId : null,
            reason: typeof d.reason === 'string' ? d.reason : null,
        }))
            .filter(d => d.similarity >= 0.7);
    }
    // ============================================================
    // 规则引擎回退 (CP-5)
    // ============================================================
    /**
     * 规则引擎: 需求增强
     */
    fallbackEnhanceRequirement(description) {
        return {
            title: null,
            description: null,
            type: inferTaskType(description),
            priority: inferTaskPriority(description),
            recommendedRole: null,
            checkpoints: null,
            dependencies: null,
            aiUsed: false,
        };
    }
    /**
     * 规则引擎: 质量评估
     */
    fallbackAnalyzeQuality(task) {
        const issues = [];
        const suggestions = [];
        let score = 60;
        // 标题检查
        if (!task.title || task.title.length < 10) {
            issues.push({ field: 'title', severity: 'warning', message: '标题过短，建议 10 字符以上' });
            score -= 10;
        }
        // 描述检查
        if (!task.description || task.description.length < 20) {
            issues.push({ field: 'description', severity: 'warning', message: '描述不充分' });
            score -= 15;
            suggestions.push('添加更详细的需求描述，包含背景、目标和方案');
        }
        // 检查点检查
        const checkpointCount = task.checkpoints?.length ?? 0;
        if (checkpointCount === 0) {
            issues.push({ field: 'checkpoints', severity: 'warning', message: '缺少检查点' });
            score -= 10;
            suggestions.push('添加具体可验证的检查点');
        }
        return {
            score: Math.max(0, Math.min(100, score)),
            issues,
            suggestions,
            aiUsed: false,
        };
    }
    /**
     * 规则引擎: 重复检测 (基于标题相似度)
     */
    fallbackDetectDuplicates(tasks) {
        const duplicates = [];
        const seen = new Set();
        for (let i = 0; i < tasks.length; i++) {
            for (let j = i + 1; j < tasks.length; j++) {
                const a = tasks[i];
                const b = tasks[j];
                // 简单的标题词重叠检测
                const wordsA = new Set(a.title.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2));
                const wordsB = new Set(b.title.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2));
                const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
                const union = new Set([...wordsA, ...wordsB]);
                const similarity = union.size > 0 ? intersection.size / union.size : 0;
                if (similarity >= 0.7) {
                    const key = [a.id, b.id].sort().join(',');
                    if (!seen.has(key)) {
                        seen.add(key);
                        duplicates.push({
                            taskIds: [a.id, b.id],
                            similarity,
                            keepTaskId: null,
                            reason: `标题词汇重叠度 ${Math.round(similarity * 100)}%`,
                        });
                    }
                }
            }
        }
        return { duplicates, aiUsed: false };
    }
    /**
     * 规则引擎: 陈旧评估
     */
    fallbackAssessStaleness(task) {
        const ageMs = Date.now() - new Date(task.updatedAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        let stalenessScore = 0;
        let suggestedAction = 'keep';
        let reason = '';
        if (ageDays > 90) {
            stalenessScore = 0.9;
            suggestedAction = 'close';
            reason = `任务已 ${Math.round(ageDays)} 天未更新，建议关闭`;
        }
        else if (ageDays > 30) {
            stalenessScore = 0.6;
            suggestedAction = 'update';
            reason = `任务已 ${Math.round(ageDays)} 天未更新，建议审查相关性`;
        }
        else if (ageDays > 14) {
            stalenessScore = 0.3;
            suggestedAction = 'keep';
            reason = `任务 ${Math.round(ageDays)} 天前更新，仍有一定时效性`;
        }
        else {
            stalenessScore = 0.1;
            suggestedAction = 'keep';
            reason = '任务近期有更新';
        }
        return {
            isStale: stalenessScore >= 0.6,
            stalenessScore,
            suggestedAction,
            reason,
            aiUsed: false,
        };
    }
    /**
     * 规则引擎: Bug 报告分析
     */
    fallbackAnalyzeBugReport(reportContent) {
        return {
            title: null,
            description: reportContent.substring(0, 500) || null,
            type: 'bug',
            priority: inferTaskPriority(reportContent),
            checkpoints: null,
            rootCause: null,
            impactScope: null,
            aiUsed: false,
        };
    }
}
