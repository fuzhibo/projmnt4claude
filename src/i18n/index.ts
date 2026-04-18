import * as fs from 'fs';
import * as path from 'path';
import { getConfigPath } from '../utils/path';

export type Language = 'zh' | 'en';

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
