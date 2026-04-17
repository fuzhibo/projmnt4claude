/**
 * 统一配置类型定义
 *
 * 所有配置相关的类型、默认值集中定义于此，
 * config.ts 和 headless-agent.ts 统一导入。
 */
/** 日志配置默认值 */
export const DEFAULT_LOGGING = {
    level: 'info',
    maxFiles: 30,
    recordInputs: true,
    inputMaxLength: 500,
};
/** AI 配置默认值 */
export const DEFAULT_AI = {
    provider: 'claude-code',
};
/** 训练数据配置默认值 */
export const DEFAULT_TRAINING = {
    exportEnabled: false,
    outputDir: '.projmnt4claude/training-data/',
};
/** Git Hook 配置默认值 */
export const DEFAULT_GIT_HOOK = {
    enabled: true,
};
/** 日志级别合法值 */
export const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
