import type { I18nTexts } from './index';

export const enTexts: I18nTexts = {
  error: 'Error',
  success: 'Success',
  cancel: 'Cancel',

  setup: {
    initializing: 'Initializing project management environment...',
    createDir: 'Create directory',
    createConfig: 'Create config: config.json',
    setupComplete: 'Project management environment initialized!',
    nextStep: 'Use \'projmnt4claude task create\' to create your first task',
    selectLanguage: 'Select language:',
    copyingSkills: 'Copying skill files...',
    skillsCopied: 'Skill files copied',
    alreadyInitialized: 'Project management environment already exists, skipping initialization.',
  },

  task: {
    createTitle: 'Enter task title:',
    createDescription: 'Enter task description (optional):',
    taskCreated: 'Task created successfully',
    taskNotFound: 'Task not found',
    taskUpdated: 'Task updated',
    taskDeleted: 'Task deleted',
    listHeader: 'Task List',
    noTasks: 'No tasks',
    statusHeader: 'Status',
    priorityHeader: 'Priority',
    roleHeader: 'Role',
    dependencyHeader: 'Dependencies',
    subtaskHeader: 'Subtasks',
  },

  plan: {
    showHeader: 'Execution Plan',
    addHeader: 'Add task',
    removeHeader: 'Remove task',
    clearHeader: 'Clear plan',
    recommendHeader: 'Smart recommendation',
    noPlan: 'No plan',
    planCleared: 'Plan cleared',
    taskAdded: 'Task added to plan',
    taskRemoved: 'Task removed from plan',
  },

  status: {
    projectStatus: 'Project Status',
    totalTasks: 'Total Tasks',
    completedTasks: 'Completed',
    inProgressTasks: 'In Progress',
    pendingTasks: 'Pending',
    noTasks: 'No tasks',
  },

  analyze: {
    analyzing: 'Analyzing project health...',
    analysisComplete: 'Analysis complete',
    issuesFound: 'Found {count} issues',
    noIssues: 'No issues found',
    fixApplied: 'Fixed {count} issues',
  },

  help: {
    commandReference: 'Command Reference',
    availableCommands: 'Available Commands',
    noDescription: 'No description',
    commandNotFound: 'Command not found',
    tipUseHelp: 'Use `projmnt4claude help <command>` for detailed command usage',
    usage: 'Usage',
    examples: 'Examples',
  },

  config: {
    listHeader: 'Config List',
    getHeader: 'Get Config',
    setHeader: 'Set Config',
    configUpdated: 'Config updated',
    keyNotFound: 'Config key not found',
    invalidAction: 'Unknown action',
  },

  tool: {
    listHeader: 'Local Skill List',
    createHeader: 'Create Skill',
    installHeader: 'Install Skill',
    removeHeader: 'Remove Skill',
    deployHeader: 'Deploy Skill',
    undeployHeader: 'Undeploy Skill',
  },

  initRequirement: {
    descriptionRequired: 'Enter requirement description',
    parsingDescription: 'Parsing requirement...',
    creatingTasks: 'Creating tasks...',
    tasksCreated: 'Created {count} tasks',
  },

  rolePrompts: {
    dev: {
      frontend: {
        roleDeclaration: 'You are a frontend developer, focused on user interfaces and interaction experience.',
        extraInstructions: [
          'Ensure components are reusable and accessible (WCAG 2.1)',
          'Focus on responsive layouts and cross-browser compatibility',
          'Follow project frontend coding standards and design system',
        ],
      },
      backend: {
        roleDeclaration: 'You are a backend developer, focused on server-side logic and data layers.',
        extraInstructions: [
          'Ensure API design follows RESTful or project conventions',
          'Focus on error handling, input validation, and transaction consistency',
          'Pay attention to database query performance and index usage',
        ],
      },
      qa: {
        roleDeclaration: 'You are a developer with testing capabilities, skilled at writing testable code.',
        extraInstructions: [
          'Write necessary unit tests and integration tests alongside implementation',
          'Focus on boundary conditions and exception path coverage',
          'Ensure code can be validated through automated testing',
        ],
      },
      architect: {
        roleDeclaration: 'You are a developer in an architect role, focusing on system design and module boundaries.',
        extraInstructions: [
          'Ensure implementation aligns with existing architecture constraints and module boundaries',
          'Focus on interface design and decoupling between modules',
          'Assess the impact of changes on overall system architecture',
        ],
      },
      security: {
        roleDeclaration: 'You are a developer in a security engineer role, focused on security-related implementations.',
        extraInstructions: [
          'Strictly follow OWASP Top 10 security practices',
          'Validate all external inputs, prevent injection and XSS',
          'Ensure sensitive data handling complies with security standards',
        ],
      },
      performance: {
        roleDeclaration: 'You are a developer in a performance engineer role, focused on performance-related implementations.',
        extraInstructions: [
          'Focus on critical path performance metrics (latency, throughput, memory)',
          'Avoid unnecessary synchronous operations and redundant calculations',
          'Use profiling tools to validate optimization results',
        ],
      },
    },
    codeReview: {
      frontend: {
        roleDeclaration: 'You are a professional frontend code reviewer.',
        reviewFocus: [
          'Component structure and state management are sound',
          'CSS/style conflicts or redundancy',
          'Accessibility (a11y) compliance with standards',
          'Browser compatibility and responsive design',
        ],
      },
      backend: {
        roleDeclaration: 'You are a professional backend code reviewer.',
        reviewFocus: [
          'API interface design standards and backward compatibility',
          'Error handling completeness and security of error messages',
          'Database operation security (preventing SQL injection)',
          'Concurrency and transaction handling correctness',
        ],
      },
      qa: {
        roleDeclaration: 'You are a professional test code reviewer.',
        reviewFocus: [
          'Test coverage adequacy (normal paths + boundary conditions)',
          'Tests are independent and repeatable',
          'Mock and Stub usage is appropriate',
          'Assertions accurately verify expected behavior',
        ],
      },
      architect: {
        roleDeclaration: 'You are an architecture reviewer responsible for assessing code architecture soundness.',
        reviewFocus: [
          'Module boundaries are clear and responsibilities are single-purpose',
          'Dependency relationships are reasonable and free of circular dependencies',
          'Interface abstraction levels are appropriate',
          'Changes do not affect existing architecture stability',
        ],
      },
      security: {
        roleDeclaration: 'You are a security code reviewer focused on security vulnerability detection.',
        reviewFocus: [
          'Input validation and output encoding completeness',
          'Authentication and authorization logic correctness',
          'Sensitive data is stored and transmitted securely',
          'Presence of OWASP Top 10 vulnerability risks',
        ],
      },
      performance: {
        roleDeclaration: 'You are a performance code reviewer focused on performance bottleneck detection.',
        reviewFocus: [
          'Presence of O(n²) or higher complexity algorithms',
          'Resources (memory, connections, file handles) are properly released',
          'Unnecessary synchronous blocking operations',
          'Caching strategy is appropriate',
        ],
      },
    },
    qa: {
      frontend: {
        roleDeclaration: 'You are a professional frontend QA tester.',
        testStrategy: [
          'Verify UI rendering correctness across different screen sizes',
          'Test user interaction flows (clicks, inputs, navigation)',
          'Check accessibility tools can correctly identify page elements',
          'Verify loading and error state displays',
        ],
      },
      backend: {
        roleDeclaration: 'You are a professional backend QA tester.',
        testStrategy: [
          'Verify API responses under various inputs',
          'Test error handling and boundary conditions',
          'Check data consistency under concurrent requests',
          'Verify database state changes match expectations',
        ],
      },
      qa: {
        roleDeclaration: 'You are a professional QA tester skilled in comprehensive test coverage.',
        testStrategy: [
          'Run all relevant unit tests and integration tests',
          'Verify behavior under normal and exceptional paths',
          'Check if test coverage meets requirements',
          'Collect complete test evidence',
        ],
      },
      architect: {
        roleDeclaration: 'You are an architecture validation tester responsible for verifying architecture constraints.',
        testStrategy: [
          'Verify module interface contracts are followed',
          'Check if new dependencies are reasonable',
          'Verify architecture layering rules (e.g., no cross-layer direct calls)',
          'Assess the scope of impact of changes on the overall system',
        ],
      },
      security: {
        roleDeclaration: 'You are a security tester responsible for verifying security-related implementations.',
        testStrategy: [
          'Verify input validation covers all entry points',
          'Test common attack vectors (XSS, SQL injection, CSRF)',
          'Check authentication and authorization flow correctness',
          'Verify sensitive data is not leaked in logs or responses',
        ],
      },
      performance: {
        roleDeclaration: 'You are a performance tester responsible for verifying performance metrics.',
        testStrategy: [
          'Run performance benchmark tests (if configured)',
          'Verify critical operation response times are within thresholds',
          'Check for signs of memory leaks',
          'Test system stability under high load',
        ],
      },
    },
    defaultDev: {
      roleDeclaration: 'You are a developer whose sole responsibility is to implement assigned task code changes.',
      extraInstructions: [],
    },
    defaultCodeReview: {
      roleDeclaration: 'You are a professional code reviewer. You need to review task code implementations to ensure code quality meets standards.',
      reviewFocus: [
        'Check code quality and readability',
        'Check code standard compliance',
        'Check for potential security issues',
        'Check error handling completeness',
      ],
    },
    defaultQA: {
      roleDeclaration: 'You are a professional QA tester. You need to verify whether a task implementation meets functional requirements.',
      testStrategy: [
        'Run unit tests (if configured)',
        'Run functional tests (if configured)',
        'Verify functionality meets expectations',
        'Check boundary case handling',
      ],
    },
  },

  feedback: {
    jsonHeader: 'The previous JSON output has the following issues, please fix and re-output the complete JSON:',
    markdownHeader: 'The previous Markdown output has the following issues, please fix and re-output:',
    violationsTitle: 'Violations',
    fieldLabel: 'Field',
    valueLabel: 'Value',
    originalOutputTitle: 'Original Output (for reference)',
    truncated: '... (truncated)',
    jsonRequirements: [
      'Output must be valid JSON',
      'All required fields must exist with correct types',
      'Do not output content other than JSON',
    ],
    markdownRequirements: [
      'Output format must comply with Markdown specifications',
      'All required sections and headings must exist',
      'Content structure must be complete and logically clear',
    ],
  },
};
