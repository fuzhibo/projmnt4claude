/**
 * 需求/问题分解类型定义
 *
 * 用于支持 init-requirement 将复杂需求或调查报告分解为多个独立任务
 */
/**
 * 默认问题检测模式
 */
export const DEFAULT_PROBLEM_PATTERNS = [
    {
        name: 'numbered_problem',
        regex: /(?:^|\n)\s*(?:问题|Issue|Bug|缺陷)\s*(\d+)[.:\-]\s*([^\n]+)/gi,
        priorityExtractor: () => 'P2',
    },
    {
        name: 'bullet_problem',
        regex: /(?:^|\n)\s*[-*]\s*(?:\[?(P\d|紧急|高|中|低)\]?)?\s*([^\n]{10,200})/gi,
        priorityExtractor: (match) => {
            const priority = match[1];
            if (priority?.includes('P0') || priority?.includes('紧急'))
                return 'P0';
            if (priority?.includes('P1') || priority?.includes('高'))
                return 'P1';
            if (priority?.includes('P3') || priority?.includes('低'))
                return 'P3';
            return 'P2';
        },
    },
    {
        name: 'section_problem',
        regex: /(?:^|\n)(?:#{1,3}\s+)([^\n]{5,100})/gi,
        priorityExtractor: () => 'P2',
    },
];
/**
 * 最小字段长度约束
 */
export const DECOMPOSITION_CONSTRAINTS = {
    /** 标题最小长度 */
    MIN_TITLE_LENGTH: 10,
    /** 问题描述最小长度 */
    MIN_PROBLEM_LENGTH: 50,
    /** 解决方案最小长度 */
    MIN_SOLUTION_LENGTH: 50,
    /** 根因分析最小长度 */
    MIN_ROOT_CAUSE_LENGTH: 20,
    /** 最小检查点数量 */
    MIN_CHECKPOINTS: 1,
    /** 有效优先级列表 */
    VALID_PRIORITIES: ['P0', 'P1', 'P2', 'P3'],
};
