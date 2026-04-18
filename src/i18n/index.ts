import * as fs from 'fs';
import * as path from 'path';
import { getConfigPath } from '../utils/path';

export type Language = 'zh' | 'en';

/** 角色类型 */
export type RoleType = 'frontend' | 'backend' | 'qa' | 'architect' | 'security' | 'performance';

/** 开发阶段角色模板 */
export interface DevRoleTemplate {
  roleDeclaration: string;
  extraInstructions: string[];
}

/** 代码审核阶段角色模板 */
export interface CodeReviewRoleTemplate {
  roleDeclaration: string;
  reviewFocus: string[];
}

/** QA 阶段角色模板 */
export interface QARoleTemplate {
  roleDeclaration: string;
  testStrategy: string[];
}

/** 角色提示词配置 */
export interface RolePrompts {
  dev: Record<RoleType, DevRoleTemplate>;
  codeReview: Record<RoleType, CodeReviewRoleTemplate>;
  qa: Record<RoleType, QARoleTemplate>;
  defaultDev: DevRoleTemplate;
  defaultCodeReview: CodeReviewRoleTemplate;
  defaultQA: QARoleTemplate;
}

export interface I18nTexts {
  // 通用
  error: string;
  success: string;
  cancel: string;
  // setup 命令
  setup: {
    initializing: string;
    createDir: string;
    createConfig: string;
    setupComplete: string;
    nextStep: string;
    selectLanguage: string;
    copyingSkills: string;
    skillsCopied: string;
    alreadyInitialized: string;
  };
  // task 命令
  task: {
    createTitle: string;
    createDescription: string;
    taskCreated: string;
    taskNotFound: string;
    taskUpdated: string;
    taskDeleted: string;
    listHeader: string;
    noTasks: string;
    statusHeader: string;
    priorityHeader: string;
    roleHeader: string;
  dependencyHeader: string;
    subtaskHeader: string;
  };
  // plan 命令
  plan: {
    showHeader: string;
    addHeader: string;
    removeHeader: string;
    clearHeader: string;
    recommendHeader: string;
    noPlan: string;
    planCleared: string;
    taskAdded: string;
    taskRemoved: string;
  };
  // status 命令
  status: {
    projectStatus: string;
    totalTasks: string;
    completedTasks: string;
    inProgressTasks: string;
    pendingTasks: string;
    noTasks: string;
  };
  // analyze 命令
  analyze: {
    analyzing: string;
    analysisComplete: string;
    issuesFound: string;
    noIssues: string;
    fixApplied: string;
  };
  // help 命令
  help: {
    commandReference: string;
    availableCommands: string;
    noDescription: string;
    commandNotFound: string;
    tipUseHelp: string;
    usage: string;
    examples: string;
  };
  // config 命令
  config: {
    listHeader: string;
    getHeader: string;
    setHeader: string;
    configUpdated: string;
    keyNotFound: string;
    invalidAction: string;
  };
  // tool 命令
  tool: {
    listHeader: string;
    createHeader: string;
    installHeader: string;
    removeHeader: string;
    deployHeader: string;
    undeployHeader: string;
  };
  // init-requirement 命令
  initRequirement: {
    descriptionRequired: string;
    parsingDescription: string;
    creatingTasks: string;
    tasksCreated: string;
  };
  // role prompts
  rolePrompts: RolePrompts;

  // feedback constraint engine
  feedback: {
    jsonHeader: string;
    markdownHeader: string;
    violationsTitle: string;
    fieldLabel: string;
    valueLabel: string;
    originalOutputTitle: string;
    truncated: string;
    jsonRequirements: string[];
    markdownRequirements: string[];
  };
}

// 导入语言包
import { zhTexts } from './zh';
import { enTexts } from './en';

const languagePacks: Record<Language, I18nTexts> = {
  zh: zhTexts,
  en: enTexts,
};

/**
 * 获取用户项目配置的语言
 */
export function getLanguage(cwd: string = process.cwd()): Language {
  const configPath = getConfigPath(cwd);
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.language || 'en';
    }
  } catch (error) {
    // 忽略错误，使用默认语言
  }
  return 'en';
}

/**
 * 获取国际化文本
 */
export function getI18n(language?: Language, cwd?: string): I18nTexts {
  const lang = language || getLanguage(cwd);
  return languagePacks[lang] || languagePacks.zh;
}

/**
 * 快捷函数：获取当前语言的文本
 */
export function t(cwd?: string): I18nTexts {
  return getI18n(undefined, cwd);
}
