/**
 * 需要验证命令的验证方法类型
 * functional_test 等自动化验证方法必须包含 commands 或 steps
 */
const METHODS_REQUIRING_COMMANDS = [
    'functional_test',
    'unit_test',
    'integration_test',
    'e2e_test',
    'automated',
    'lint',
];
/**
 * 校验检查点的验证信息是否完整
 * - functional_test 等自动化方法必须有 commands 或 steps
 * - 返回校验结果和警告信息
 */
export function validateCheckpointVerification(checkpoint) {
    if (!checkpoint.verification) {
        return { valid: true };
    }
    const { method, commands, steps } = checkpoint.verification;
    if (METHODS_REQUIRING_COMMANDS.includes(method)) {
        const hasCommands = commands && commands.length > 0;
        const hasSteps = steps && steps.length > 0;
        if (!hasCommands && !hasSteps) {
            return {
                valid: false,
                warning: `检查点 "${checkpoint.description}" 的验证方法为 ${method}，但缺少 commands 或 steps`,
            };
        }
    }
    return { valid: true };
}
/**
 * Pipeline 阶段到角色的映射
 * 用于角色感知恢复逻辑，确定每个阶段对应的处理角色
 */
export const PHASE_ROLE_MAP = {
    development: 'executor',
    code_review: 'code_reviewer',
    qa_verification: 'qa_tester',
    qa: 'qa_tester',
    evaluation: 'architect',
};
/**
 * Pipeline 类
 * 提供阶段流转和角色感知恢复的核心逻辑
 */
export class Pipeline {
    /** 阶段到角色的映射 */
    static PHASE_ROLE_MAP = PHASE_ROLE_MAP;
    /** Pipeline 阶段顺序 */
    static PHASE_ORDER = ['development', 'code_review', 'qa_verification', 'evaluation'];
    /**
     * 根据阶段获取对应角色
     */
    static getRoleForPhase(phase) {
        return Pipeline.PHASE_ROLE_MAP[phase] || 'executor';
    }
    /**
     * 角色感知恢复逻辑
     * 根据 resumeAction 和已完成的阶段确定恢复点（阶段+角色）
     *
     * @param phaseHistory - 已完成的阶段历史
     * @param resumeAction - 恢复动作：retry=重试失败阶段，next=跳到下一阶段
     * @returns 恢复点信息（阶段+角色），或 null 表示无法确定
     */
    static determineResumePoint(phaseHistory, resumeAction) {
        if (phaseHistory.length === 0) {
            // 无历史记录，从开发阶段开始
            return { phase: 'development', role: 'executor' };
        }
        const lastEntry = phaseHistory[phaseHistory.length - 1];
        const lastPhaseIndex = Pipeline.PHASE_ORDER.indexOf(lastEntry.phase);
        if (resumeAction === 'retry') {
            // retry: 重试最后失败/执行的阶段
            return {
                phase: lastEntry.phase,
                role: Pipeline.getRoleForPhase(lastEntry.phase),
            };
        }
        // next: 跳到下一阶段
        if (lastPhaseIndex === -1 || lastPhaseIndex >= Pipeline.PHASE_ORDER.length - 1) {
            // 已在最后阶段或未知阶段，从开发阶段重新开始
            return { phase: 'development', role: 'executor' };
        }
        const nextPhase = Pipeline.PHASE_ORDER[lastPhaseIndex + 1];
        return {
            phase: nextPhase,
            role: Pipeline.getRoleForPhase(nextPhase),
        };
    }
}
/**
 * 当前任务元数据 schema 版本
 * 每次规范变更时递增，analyze 命令据此进行增量迁移
 *
 * 版本历史:
 * - 0: 无 schemaVersion 字段（旧版任务）
 * - 1: 添加 reopenCount + requirementHistory（legacy_schema）
 * - 2: pipeline_status 规范化 + verdict_action_schema 验证
 * - 3: commitHistory 字段（harness 批次 git commit SHA 追踪）
 * - 4: reopened→open 迁移 + TransitionNote + resumeAction
 * - 5: 检查点前缀自动补全（为无前缀的检查点添加规范前缀）
 * - 6: 添加 checkpointPolicy 字段（自动推断检查点策略）
 */
export const CURRENT_TASK_SCHEMA_VERSION = 6;
/**
 * 流水线中间状态列表
 * 这些状态仅用于 harness pipeline 执行期间，旧任务若停留在此状态
 * 表示 pipeline 中断或使用了旧版规范
 */
export const PIPELINE_INTERMEDIATE_STATUSES = [
    'wait_review',
    'wait_qa',
    'wait_evaluation',
    'needs_human',
];
/**
 * 流水线状态迁移映射
 * 旧版 pipeline 中间状态 → 最新规范状态
 */
export const PIPELINE_STATUS_MIGRATION_MAP = {
    'reopened': 'open', // 已重开 → 重新打开
    'needs_human': 'open', // 需要人工介入 → 回到待处理
    'wait_review': 'in_progress', // 等待代码审核 → 回到开发中
    'wait_qa': 'in_progress', // 等待 QA → 回到开发中
    'wait_evaluation': 'wait_qa', // 等待评估 → 回退到等待 QA（无评估报告时）
};
/**
 * 统一的状态规范化函数
 * 合并所有已知变体: pending→open, completed→resolved, cancelled→abandoned,
 * reopened→open, needs_human→open, blocked→open, reopen→open 等
 */
export function normalizeStatus(status) {
    const statusMap = {
        // 旧格式映射
        'pending': 'open',
        'reopen': 'open',
        'reopened': 'open',
        'completed': 'resolved',
        'cancelled': 'abandoned',
        'blocked': 'open',
        'needs_human': 'open',
        // 标准格式直接返回
        'open': 'open',
        'in_progress': 'in_progress',
        'wait_review': 'wait_review',
        'wait_qa': 'wait_qa',
        'wait_evaluation': 'wait_evaluation',
        'resolved': 'resolved',
        'closed': 'closed',
        'abandoned': 'abandoned',
        'failed': 'failed',
    };
    return statusMap[status] || 'open';
}
/**
 * 统一的优先级规范化函数
 * 映射: urgent→P0, high→P1, medium→P2, low→P3 等
 */
export function normalizePriority(priority) {
    const priorityMap = {
        'urgent': 'P0',
        'high': 'P1',
        'medium': 'P2',
        'low': 'P3',
        // 已经是新格式的直接返回
        'P0': 'P0',
        'P1': 'P1',
        'P2': 'P2',
        'P3': 'P3',
        'Q1': 'Q1',
        'Q2': 'Q2',
        'Q3': 'Q3',
        'Q4': 'Q4',
    };
    return priorityMap[priority] || 'P2';
}
/**
 * 待验证队列文件结构
 */
/**
 * 创建默认任务元数据
 *
 * 自动推断 checkpointPolicy 基于任务类型和优先级：
 * - P0/P1 优先级：'required'（必须配置检查点）
 * - bug/feature 类型：'required'（必须配置检查点）
 * - docs/refactor 类型：'optional'（检查点可选）
 */
export function createDefaultTaskMeta(id, title, type = 'feature', description, createdBy) {
    const now = new Date().toISOString();
    const priority = 'P2';
    const checkpointPolicy = inferCheckpointPolicy(type, priority);
    return {
        id,
        title,
        description,
        type,
        priority,
        status: 'open',
        dependencies: [],
        createdAt: now,
        updatedAt: now,
        history: [],
        reopenCount: 0,
        requirementHistory: [],
        createdBy,
        schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
        checkpointPolicy,
    };
}
/**
 * 验证任务ID格式
 * 支持多种格式:
 * - 新格式: TASK-{type}-{priority}-{slug}-{date}
 * - 旧格式: TASK-001
 * - 任意格式: 只要是非空字符串且包含字母、数字、连字符
 */
export function isValidTaskId(id) {
    if (!id || id.trim().length === 0) {
        return false;
    }
    // 放宽验证：允许任何非空字符串作为任务ID
    return /^[a-zA-Z0-9\-_]+$/.test(id);
}
/**
 * 解析任务ID
 */
export function parseTaskId(id) {
    // 旧格式: TASK-001
    if (/^TASK-\d{3,}$/.test(id)) {
        return {
            valid: true,
            format: 'old',
            raw: id,
        };
    }
    // 新格式: TASK-{type}-{priority}-{slug}-{date}
    const newFormat = /^TASK-(bug|feature|research|docs|refactor|test)-([PQ]\d)-([a-z0-9\-]+)-(\d{8})(?:-\d+)?$/;
    const match = id.match(newFormat);
    if (match) {
        return {
            valid: true,
            format: 'new',
            type: match[1],
            priority: match[2],
            slug: match[3],
            date: match[4],
            raw: id,
        };
    }
    // 兼容旧的新格式（没有type）: TASK-P1-user-auth-open-auth-20260306
    const legacyFormat = /^TASK-([PQ]\d)-([a-z0-9\-]+)-([a-z]+)-([a-z0-9]+)-(\d{8})(?:-\d+)?$/;
    const legacyMatch = id.match(legacyFormat);
    if (legacyMatch) {
        return {
            valid: true,
            format: 'new', // 标记为新格式但缺少type
            priority: legacyMatch[1],
            slug: legacyMatch[2],
            date: legacyMatch[5],
            raw: id,
        };
    }
    // 宽松格式：TASK-{任意内容}
    if (id.startsWith('TASK-') && id.length > 5) {
        return {
            valid: true,
            format: 'unknown',
            raw: id,
        };
    }
    return {
        valid: false,
        format: 'unknown',
        raw: id,
    };
}
/**
 * 检查是否为旧格式任务ID
 */
export function isOldFormatTaskId(id) {
    return /^TASK-\d{3,}$/.test(id);
}
/**
 * 检查是否需要转换（旧格式或缺少type的新格式）
 */
export function needsConversion(id) {
    const info = parseTaskId(id);
    return info.valid && (info.format === 'old' || !info.type);
}
/**
 * 生成任务ID (新格式)
 * 格式: TASK-{type}-{priority}-{slug}-{date}
 * 例如: TASK-feature-P1-user-auth-20260306
 */
export function generateTaskId(type, priority, title, existingIds = []) {
    // 从标题生成 slug
    // 第一步：尝试提取 ASCII 单词和数字
    const asciiParts = title.match(/[a-zA-Z][a-zA-Z0-9]*|\d+/g);
    let slug;
    if (asciiParts && asciiParts.length > 0) {
        // 标题包含英文/数字部分，直接使用
        slug = asciiParts
            .join('-')
            .toLowerCase()
            .substring(0, 40);
    }
    else {
        // 纯非ASCII标题（如中文），使用类型缩写+哈希生成有意义标识
        const typePrefix = {
            feature: 'feat',
            bugfix: 'fix',
            refactor: 'ref',
            docs: 'doc',
            test: 'test',
            chore: 'chore',
        };
        let hash = 0;
        for (let i = 0; i < title.length; i++) {
            hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
        }
        const prefix = typePrefix[type] || 'task';
        slug = `${prefix}-${Math.abs(hash).toString(36)}`;
    }
    // 生成日期字符串
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // 生成新格式 ID
    let newId = `TASK-${type}-${priority}-${slug}-${date}`;
    // 检查是否已存在
    if (existingIds.includes(newId)) {
        let counter = 1;
        while (existingIds.includes(`${newId}-${counter}`)) {
            counter++;
        }
        newId = `${newId}-${counter}`;
    }
    return newId;
}
/**
 * 转换旧格式任务ID为新格式
 */
export function convertTaskId(oldId, type, priority, title, existingIds = []) {
    // 如果已经是新格式且有type，直接返回
    const info = parseTaskId(oldId);
    if (info.format === 'new' && info.type) {
        return oldId;
    }
    // 生成新格式ID
    return generateTaskId(type, priority, title, existingIds);
}
/**
 * 从标题推断任务类型
 */
export function inferTaskType(title) {
    const lowerTitle = title.toLowerCase();
    // Bug 关键词
    if (/\b(fix|bug|error|issue|crash|broken|fail|problem|修复|错误|问题|故障)\b/.test(lowerTitle)) {
        return 'bug';
    }
    // Research 关键词
    if (/\b(research|investigate|analyze|study|explore|调研|研究|分析|探索)\b/.test(lowerTitle)) {
        return 'research';
    }
    // Docs 关键词
    if (/\b(doc|document|readme|guide|manual|文档|说明|指南)\b/.test(lowerTitle)) {
        return 'docs';
    }
    // Refactor 关键词
    if (/\b(refactor|clean|improve|optimize|restructure|重构|优化|改进)\b/.test(lowerTitle)) {
        return 'refactor';
    }
    // Test 关键词
    if (/\b(test|spec|coverage|测试|单元测试|集成测试)\b/.test(lowerTitle)) {
        return 'test';
    }
    // 默认为 feature
    return 'feature';
}
/**
 * 从标题推断优先级
 */
export function inferTaskPriority(title) {
    const lowerTitle = title.toLowerCase();
    if (/\b(urgent|critical|asap|紧急|严重|立即)\b/.test(lowerTitle)) {
        return 'P0';
    }
    if (/\b(important|high|优先|重要)\b/.test(lowerTitle)) {
        return 'P1';
    }
    if (/\b(low|optional|可选|低)\b/.test(lowerTitle)) {
        return 'P3';
    }
    return 'P2';
}
/**
 * 根据任务类型和优先级推断检查点策略
 *
 * 推断规则：
 * - P0/P1 优先级：必须配置检查点 ('required')
 * - P2/P3 优先级：检查点可选 ('optional')
 * - Q1-Q4 优先级：检查点可选 ('optional')
 *
 * @param type - 任务类型
 * @param priority - 任务优先级
 * @returns CheckpointPolicy 推断的检查点策略
 *
 * @example
 * ```typescript
 * inferCheckpointPolicy('bug', 'P0');     // 'required'
 * inferCheckpointPolicy('docs', 'P3');    // 'optional'
 * inferCheckpointPolicy('feature', 'P2'); // 'optional'
 * ```
 */
export function inferCheckpointPolicy(type, priority) {
    // P0/P1 高优先级任务必须配置检查点
    if (priority === 'P0' || priority === 'P1') {
        return 'required';
    }
    // P2/P3 及 Q1-Q4 优先级任务检查点可选
    return 'optional';
}
/**
 * 生成下一个任务ID (旧格式，保持兼容)
 */
export function generateNextTaskId(existingIds) {
    if (existingIds.length === 0) {
        return 'TASK-001';
    }
    const numbers = existingIds
        .map(id => {
        const match = id.match(/^TASK-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
    })
        .filter(n => n > 0);
    const maxNumber = Math.max(...numbers, 0);
    return `TASK-${String(maxNumber + 1).padStart(3, '0')}`;
}
