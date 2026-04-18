import type { I18nTexts } from './index';

export const zhTexts: I18nTexts = {
  error: '错误',
  success: '成功',
  cancel: '取消',

  setup: {
    initializing: '正在初始化项目管理环境...',
    createDir: '创建目录',
    createConfig: '创建配置: config.json',
    setupComplete: '项目管理环境初始化完成！',
    nextStep: '使用 \'projmnt4claude task create\' 创建第一个任务',
    selectLanguage: '请选择语言:',
    copyingSkills: '正在复制技能文件...',
    skillsCopied: '技能文件复制完成',
    alreadyInitialized: '项目管理环境已存在，跳过初始化。',
  },

  task: {
    createTitle: '请输入任务标题:',
    createDescription: '请输入任务描述（可选）:',
    taskCreated: '任务创建成功',
    taskNotFound: '未找到任务',
    taskUpdated: '任务已更新',
    taskDeleted: '任务已删除',
    listHeader: '任务列表',
    noTasks: '暂无任务',
    statusHeader: '状态',
    priorityHeader: '优先级',
    roleHeader: '推荐角色',
    dependencyHeader: '依赖',
    subtaskHeader: '子任务',
  },

  plan: {
    showHeader: '执行计划',
    addHeader: '添加任务',
    removeHeader: '移除任务',
    clearHeader: '清空计划',
    recommendHeader: '智能推荐',
    noPlan: '暂无计划',
    planCleared: '计划已清空',
    taskAdded: '任务已添加到计划',
    taskRemoved: '任务已从计划移除',
  },

  status: {
    projectStatus: '项目状态',
    totalTasks: '总任务数',
    completedTasks: '已完成',
    inProgressTasks: '进行中',
    pendingTasks: '待处理',
    noTasks: '无任务',
  },

  analyze: {
    analyzing: '正在分析项目健康状态...',
    analysisComplete: '分析完成',
    issuesFound: '发现 {count} 个问题',
    noIssues: '未发现问题',
    fixApplied: '已修复 {count} 个问题',
  },

  help: {
    commandReference: '命令参考',
    availableCommands: '可用命令',
    noDescription: '暂无描述',
    commandNotFound: '未找到命令',
    tipUseHelp: '使用 `projmnt4claude help <command>` 查看命令详细说明',
    usage: '使用方式',
    examples: '示例',
  },

  config: {
    listHeader: '配置列表',
    getHeader: '获取配置',
    setHeader: '设置配置',
    configUpdated: '配置已更新',
    keyNotFound: '配置项不存在',
    invalidAction: '未知操作',
  },

  tool: {
    listHeader: '本地 skill 列表',
    createHeader: '创建 skill',
    installHeader: '安装 skill',
    removeHeader: '删除 skill',
    deployHeader: '部署 skill',
    undeployHeader: '卸载 skill',
  },

  initRequirement: {
    descriptionRequired: '请输入需求描述',
    parsingDescription: '正在解析需求...',
    creatingTasks: '正在创建任务...',
    tasksCreated: '已创建 {count} 个任务',
  },

  rolePrompts: {
    dev: {
      frontend: {
        roleDeclaration: '你是一个前端开发者，专注于用户界面和交互体验。',
        extraInstructions: [
          '确保组件可复用、可访问性（WCAG 2.1）良好',
          '关注响应式布局和跨浏览器兼容性',
          '遵循项目的前端代码规范和设计系统',
        ],
      },
      backend: {
        roleDeclaration: '你是一个后端开发者，专注于服务端逻辑和数据层。',
        extraInstructions: [
          '确保 API 接口设计遵循 RESTful 或项目约定',
          '关注错误处理、输入验证和事务一致性',
          '注意数据库查询性能和索引使用',
        ],
      },
      qa: {
        roleDeclaration: '你是一个具有测试开发能力的开发者，擅长编写可测试的代码。',
        extraInstructions: [
          '实现时同步编写必要的单元测试和集成测试',
          '关注边界条件和异常路径的覆盖',
          '确保代码可通过自动化测试验证',
        ],
      },
      architect: {
        roleDeclaration: '你是一个架构师角色的开发者，关注系统设计和模块边界。',
        extraInstructions: [
          '确保实现符合现有架构约束和模块边界',
          '关注接口设计和模块间解耦',
          '评估变更对系统整体架构的影响',
        ],
      },
      security: {
        roleDeclaration: '你是一个安全工程师角色的开发者，专注于安全相关实现。',
        extraInstructions: [
          '严格遵循 OWASP Top 10 安全实践',
          '验证所有外部输入、防止注入和 XSS',
          '确保敏感数据处理符合安全规范',
        ],
      },
      performance: {
        roleDeclaration: '你是一个性能优化工程师角色的开发者，专注于性能相关实现。',
        extraInstructions: [
          '关注关键路径的性能指标（延迟、吞吐量、内存）',
          '避免不必要的同步操作和重复计算',
          '使用性能分析工具验证优化效果',
        ],
      },
    },
    codeReview: {
      frontend: {
        roleDeclaration: '你是一个专业的前端代码审核员。',
        reviewFocus: [
          '组件结构和状态管理是否合理',
          'CSS/样式是否有冲突或冗余',
          '可访问性（a11y）是否符合标准',
          '浏览器兼容性和响应式设计',
        ],
      },
      backend: {
        roleDeclaration: '你是一个专业的后端代码审核员。',
        reviewFocus: [
          'API 接口设计是否规范、向后兼容',
          '错误处理是否完善、错误信息是否安全',
          '数据库操作是否安全（防 SQL 注入）',
          '并发和事务处理是否正确',
        ],
      },
      qa: {
        roleDeclaration: '你是一个专业的测试代码审核员。',
        reviewFocus: [
          '测试覆盖是否充分（正常路径 + 边界条件）',
          '测试是否独立、可重复执行',
          'Mock 和 Stub 使用是否合理',
          '断言是否准确验证了预期行为',
        ],
      },
      architect: {
        roleDeclaration: '你是一个架构审查员，负责审核代码的架构合理性。',
        reviewFocus: [
          '模块边界是否清晰、职责是否单一',
          '依赖关系是否合理、是否存在循环依赖',
          '接口抽象层级是否适当',
          '变更是否影响现有架构的稳定性',
        ],
      },
      security: {
        roleDeclaration: '你是一个安全代码审核员，专注于安全漏洞检测。',
        reviewFocus: [
          '输入验证和输出编码是否完善',
          '认证授权逻辑是否正确',
          '敏感数据是否安全存储和传输',
          '是否存在 OWASP Top 10 漏洞风险',
        ],
      },
      performance: {
        roleDeclaration: '你是一个性能代码审核员，专注于性能瓶颈检测。',
        reviewFocus: [
          '是否存在 O(n²) 或更高复杂度的算法',
          '资源（内存、连接、文件句柄）是否正确释放',
          '是否有不必要的同步阻塞操作',
          '缓存策略是否合理',
        ],
      },
    },
    qa: {
      frontend: {
        roleDeclaration: '你是一个专业的前端 QA 测试员。',
        testStrategy: [
          '验证 UI 渲染在不同屏幕尺寸下是否正确',
          '测试用户交互流程（点击、输入、导航）',
          '检查可访问性工具是否能正确识别页面元素',
          '验证加载状态和错误状态的展示',
        ],
      },
      backend: {
        roleDeclaration: '你是一个专业的后端 QA 测试员。',
        testStrategy: [
          '验证 API 接口在各种输入下的响应',
          '测试错误处理和边界条件',
          '检查并发请求下的数据一致性',
          '验证数据库状态变更是否符合预期',
        ],
      },
      qa: {
        roleDeclaration: '你是一个专业的 QA 测试员，擅长全面测试覆盖。',
        testStrategy: [
          '运行所有相关单元测试和集成测试',
          '验证功能在正常路径和异常路径下的行为',
          '检查测试覆盖率是否满足要求',
          '收集完整的测试证据',
        ],
      },
      architect: {
        roleDeclaration: '你是一个架构验证测试员，负责验证架构约束。',
        testStrategy: [
          '验证模块间接口契约是否被遵守',
          '检查新增依赖是否合理',
          '验证架构分层规则（如不跨层直接调用）',
          '评估变更对整体系统的影响范围',
        ],
      },
      security: {
        roleDeclaration: '你是一个安全测试员，负责验证安全相关实现。',
        testStrategy: [
          '验证输入验证是否覆盖所有入口点',
          '测试常见攻击向量（XSS、SQL 注入、CSRF）',
          '检查认证授权流程是否正确',
          '验证敏感数据是否不在日志或响应中泄露',
        ],
      },
      performance: {
        roleDeclaration: '你是一个性能测试员，负责验证性能指标。',
        testStrategy: [
          '运行性能基准测试（如有配置）',
          '验证关键操作的响应时间是否在阈值内',
          '检查是否存在内存泄漏迹象',
          '测试在高负载下的系统稳定性',
        ],
      },
    },
    defaultDev: {
      roleDeclaration: '你是一个开发者，你的唯一职责是实现被分配任务的代码变更。',
      extraInstructions: [],
    },
    defaultCodeReview: {
      roleDeclaration: '你是一个专业的代码审核员。你需要审核一个任务的代码实现，确保代码质量符合标准。',
      reviewFocus: [
        '检查代码质量和可读性',
        '检查代码规范遵守情况',
        '检查潜在的安全问题',
        '检查错误处理是否完善',
      ],
    },
    defaultQA: {
      roleDeclaration: '你是一个专业的 QA 测试员。你需要验证一个任务的实现是否满足功能要求。',
      testStrategy: [
        '运行单元测试（如有配置）',
        '运行功能测试（如有配置）',
        '验证功能是否符合预期',
        '检查边界情况处理',
      ],
    },
  },

  feedback: {
    jsonHeader: '上一次输出的 JSON 存在以下问题，请修正后重新输出完整 JSON：',
    markdownHeader: '上一次输出的 Markdown 内容存在以下问题，请修正后重新输出：',
    violationsTitle: '违规项',
    fieldLabel: '字段',
    valueLabel: '值',
    originalOutputTitle: '原始输出（供参考）',
    truncated: '... (已截断)',
    jsonRequirements: [
      '输出是合法的 JSON',
      '所有必填字段都存在且类型正确',
      '不要输出 JSON 以外的内容',
    ],
    markdownRequirements: [
      '输出格式符合 Markdown 规范',
      '所有必需的章节和标题都存在',
      '内容结构完整、逻辑清晰',
    ],
  },
};
