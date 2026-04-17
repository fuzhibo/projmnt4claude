#!/usr/bin/env bun
/**
 * 批量更新单元测试任务的检查点
 * 将模糊的通用检查点替换为具体的测试用例检查点
 */
import * as fs from 'fs';
import * as path from 'path';
const TASKS_DIR = '.projmnt4claude/tasks';
// 测试用例模板
const TEST_CASE_TEMPLATES = {
    'config.ts': [
        'ensureConfigDefaults: 配置默认值处理',
        'ensureConfigDefaults: 空配置对象处理',
        'readConfig: 成功读取配置文件',
        'readConfig: 文件不存在时返回默认值',
        'readConfig: 无效JSON格式处理',
        'writeConfig: 成功写入配置',
        'writeConfig: 目录不存在时自动创建',
        'writeConfig: 写入失败错误处理',
        'listConfig: 列出所有配置项',
        'listConfig: 空配置处理',
        'getConfig: 获取单项配置',
        'getConfig: 不存在的配置项返回undefined',
        'setConfig: 设置单项配置',
        'setConfig: 更新已有配置项',
        'setConfig: 删除配置项(设为undefined)'
    ],
    'file-utils.ts': [
        'copyTemplateFiles: 成功复制模板文件',
        'copyTemplateFiles: 源目录不存在处理',
        'copyTemplateFiles: 目标目录已存在处理',
        'ensureDirectory: 目录不存在时创建',
        'ensureDirectory: 目录已存在时返回',
        'ensureDirectory: 权限不足处理',
        'listDirectoryFiles: 列出目录文件',
        'listDirectoryFiles: 空目录返回空数组',
        'listDirectoryFiles: 目录不存在处理',
        'writeJsonFile: 成功写入JSON文件',
        'writeJsonFile: 格式化输出',
        'writeJsonFile: 循环引用处理',
        'readJsonFile: 成功读取JSON文件',
        'readJsonFile: 文件不存在返回null',
        'readJsonFile: 无效JSON格式处理'
    ],
    'ai-prompt.ts': [
        'buildSystemPrompt: 基础上下文组装',
        'buildSystemPrompt: 任务类型特定提示',
        'buildSystemPrompt: 空上下文处理',
        'renderPrompt: 模板变量替换',
        'renderPrompt: 嵌套变量访问',
        'renderPrompt: 变量不存在时保留原样',
        'escapeSpecialChars: 转义花括号',
        'escapeSpecialChars: 转义美元符号',
        'escapeSpecialChars: 转义反引号',
        'truncateContent: 按字符数截断',
        'truncateContent: 按Token数截断',
        'truncateContent: 保留重要部分',
        'formatGitHistory: 格式化提交历史',
        'formatGitHistory: 空历史处理',
        'formatGitHistory: 长提交信息截断'
    ],
    'harness-helpers.ts': [
        'parseVerdictResult: 解析通过结果',
        'parseVerdictResult: 解析失败结果',
        'parseVerdictResult: 解析需要修改结果',
        'parseVerdictResult: 无效结果格式处理',
        'parseEvaluationResult: 解析评估结果',
        'parseEvaluationResult: 评分计算',
        'parseEvaluationResult: 缺少字段处理',
        'contradictionDetectorSafeCheck: 矛盾检测安全网',
        'contradictionDetectorSafeCheck: 边界条件处理',
        'formatPromptWithContract: 合约替换',
        'formatPromptWithContract: 缺少合约字段处理',
        'buildDevelopmentPrompt: 开发提示词构建',
        'buildDevelopmentPrompt: 任务上下文注入',
        'buildDevelopmentPrompt: 检查点列表生成'
    ],
    'checkpoint.ts': [
        'saveCheckpoint: 保存新检查点',
        'saveCheckpoint: 更新已有检查点',
        'saveCheckpoint: 无效数据验证',
        'loadCheckpoint: 加载检查点',
        'loadCheckpoint: 不存在时返回null',
        'loadCheckpoint: 无效JSON处理',
        'checkpointExists: 文件存在返回true',
        'checkpointExists: 文件不存在返回false',
        'listCheckpoints: 列出所有检查点',
        'deleteCheckpoint: 删除检查点',
        'deleteCheckpoint: 不存在时静默处理',
        'getCheckpointHistory: 获取历史记录',
        'updateCheckpointStatus: 更新状态',
        'validateCheckpoint: 验证检查点格式'
    ],
    'plan.ts': [
        'readPlan: 读取执行计划',
        'readPlan: 不存在返回null',
        'readPlan: 无效JSON处理',
        'writePlan: 写入执行计划',
        'writePlan: 更新已存在计划',
        'getPlanPath: 返回正确路径',
        'createEmptyPlan: 创建空计划',
        'getOrCreatePlan: 获取或创建',
        'isExecutableStatus: 可执行状态判断',
        'getStatusPriority: 状态优先级排序'
    ],
    'contradiction-detector.ts': [
        'detectContradictions: 检测正面负面矛盾',
        'detectContradictions: 无矛盾返回空',
        'detectContradictions: 多矛盾检测',
        'checkSemanticConflict: 语义冲突检查',
        'checkConsistency: 一致性验证',
        'generateContradictionReport: 生成报告',
        'hasNegativeIndicator: 负面关键词检测',
        'hasPositiveIndicator: 正面关键词检测'
    ],
    'task-fs.ts': [
        'ensureTaskDir: 确保任务目录存在',
        'ensureTaskDir: 创建嵌套目录',
        'getTaskPath: 返回正确路径',
        'taskExists: 任务存在判断',
        'listTaskFiles: 列出任务文件',
        'readTaskFile: 读取任务文件',
        'writeTaskFile: 写入任务文件',
        'deleteTaskFile: 删除任务文件',
        'copyTaskFiles: 复制任务文件',
        'moveTaskFiles: 移动任务文件'
    ],
    'logger.ts': [
        'createLogger: 创建日志实例',
        'createLogger: 默认级别设置',
        'log: 基础日志方法',
        'log: 不同级别过滤',
        'info: 信息级别日志',
        'warn: 警告级别日志',
        'error: 错误级别日志',
        'debug: 调试级别日志',
        'logInstrumentation: 埋点日志',
        'getLogHistory: 获取日志历史'
    ],
    'feedback-constraint-engine.ts': [
        'validateFeedback: 验证反馈有效性',
        'validateFeedback: 无效反馈处理',
        'applyConstraints: 应用约束条件',
        'checkConstraintSatisfaction: 检查约束满足度',
        'generateConstraintReport: 生成约束报告',
        'getConstraintViolations: 获取违规项',
        'resetConstraints: 重置约束状态'
    ],
    'default': [
        'Mock环境搭建: 创建Mock类',
        'Mock环境搭建: 导出测试工具',
        '测试数据准备: 准备测试输入',
        '测试数据准备: 准备期望输出',
        '边界条件测试: 空输入处理',
        '边界条件测试: 异常输入处理',
        '正常流程测试: 标准输入输出',
        '错误处理测试: 错误情况处理',
        '性能测试: 大数据量处理',
        '集成测试: 与其他模块协作'
    ]
};
// 生成标准化的检查点
function generateCheckpoints(moduleName, testFunctions) {
    const checkpoints = [];
    const now = new Date().toISOString();
    // 添加测试函数的检查点
    testFunctions.forEach((func, index) => {
        const [funcName, description] = func.split(': ');
        checkpoints.push({
            id: `CP-${String(index + 1).padStart(3, '0')}`,
            description: `${funcName}: ${description}`,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        });
    });
    // 添加测试执行检查点
    checkpoints.push({
        id: 'CP-test-run',
        description: `所有 ${moduleName} 测试用例通过`,
        status: 'pending',
        category: 'qa_verification',
        verification: {
            method: 'automated_test',
            commands: [`bun test ${moduleName}.test.ts`],
            expected: '所有测试通过'
        },
        createdAt: now,
        updatedAt: now
    });
    // 添加覆盖率检查点
    checkpoints.push({
        id: 'CP-coverage',
        description: `${moduleName} 测试覆盖率 >= 80%`,
        status: 'pending',
        category: 'qa_verification',
        verification: {
            method: 'coverage_check',
            commands: [`bun test --coverage ${moduleName}.test.ts`],
            expected: '覆盖率 >= 80%'
        },
        createdAt: now,
        updatedAt: now
    });
    return checkpoints;
}
// 解析任务描述中的测试函数
function parseTestFunctions(description) {
    // 尝试匹配 "测试重点: xxx/xxx/xxx" 或 "测试: xxx/xxx"
    const match = description.match(/测试重点[:：]([^。]+)/);
    if (match) {
        const functions = match[1].split(/[/,，]/).map(f => f.trim());
        return functions.filter(f => f.length > 0);
    }
    return [];
}
// 获取模块名
function getModuleName(taskId) {
    const match = taskId.match(/TASK-feature-P2-[\d-]+-([a-z-]+)-\d+/);
    if (match) {
        return match[1].replace(/-/g, '.') + '.ts';
    }
    return 'unknown.ts';
}
// 更新单个任务
async function updateTask(taskDir) {
    const metaPath = path.join(taskDir, 'meta.json');
    const checkpointPath = path.join(taskDir, 'checkpoint.md');
    if (!fs.existsSync(metaPath)) {
        console.log(`❌ 跳过: ${taskDir} (无meta.json)`);
        return;
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    // 只处理单元测试任务
    if (!meta.title.includes('单元测试') && !meta.title.includes('测试')) {
        return;
    }
    const moduleName = getModuleName(meta.id);
    const testFunctions = parseTestFunctions(meta.description);
    // 获取或生成检查点模板
    let template = TEST_CASE_TEMPLATES[moduleName];
    if (!template) {
        // 尝试从模块名推断
        const baseName = moduleName.replace('.ts', '');
        template = TEST_CASE_TEMPLATES[baseName] || TEST_CASE_TEMPLATES['default'];
    }
    // 如果解析到了具体函数，使用它们
    if (testFunctions.length > 0) {
        const specificTests = [];
        testFunctions.forEach(func => {
            // 为每个函数生成3-5个测试用例
            specificTests.push(`${func}: 正常输入处理`, `${func}: 边界条件处理`, `${func}: 异常输入处理`);
        });
        template = specificTests;
    }
    // 生成新检查点
    const newCheckpoints = generateCheckpoints(moduleName, template.slice(0, 25));
    // 更新meta.json
    meta.checkpoints = newCheckpoints;
    meta.updatedAt = new Date().toISOString();
    // 添加历史记录
    meta.history.push({
        timestamp: new Date().toISOString(),
        action: '更新检查点',
        field: 'checkpoints',
        oldValue: `${meta.checkpoints?.length || 0}个模糊检查点`,
        newValue: `${newCheckpoints.length}个具体测试用例检查点`
    });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    // 更新checkpoint.md
    const checkpointContent = `# ${meta.id} 检查点

${newCheckpoints.map(cp => `- [ ] ${cp.description}`).join('\n')}
`;
    fs.writeFileSync(checkpointPath, checkpointContent, 'utf-8');
    console.log(`✅ 更新: ${meta.id}`);
    console.log(`   检查点: ${newCheckpoints.length}个 (原为${meta.checkpoints?.length || 0}个)`);
}
// 主函数
async function main() {
    console.log('🚀 开始批量更新单元测试任务检查点...\n');
    const taskDirs = fs.readdirSync(TASKS_DIR)
        .filter(dir => dir.startsWith('TASK-'))
        .map(dir => path.join(TASKS_DIR, dir));
    let updated = 0;
    let skipped = 0;
    for (const taskDir of taskDirs) {
        const stat = fs.statSync(taskDir);
        if (!stat.isDirectory())
            continue;
        try {
            const metaPath = path.join(taskDir, 'meta.json');
            if (!fs.existsSync(metaPath)) {
                skipped++;
                continue;
            }
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            // 只处理单元测试任务
            if (meta.title && (meta.title.includes('单元测试') || meta.title.includes('测试'))) {
                await updateTask(taskDir);
                updated++;
            }
            else {
                skipped++;
            }
        }
        catch (error) {
            console.error(`❌ 错误: ${taskDir}`, error);
            skipped++;
        }
    }
    console.log(`\n📊 更新完成:`);
    console.log(`   已更新: ${updated} 个任务`);
    console.log(`   已跳过: ${skipped} 个任务`);
}
main().catch(console.error);
