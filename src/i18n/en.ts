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

  hook: {
    enableHeader: 'Enable Hooks',
    disableHeader: 'Disable Hooks',
    statusHeader: 'Hook Status',
    alreadyEnabled: 'Hooks already enabled',
    alreadyDisabled: 'Hooks already disabled',
  },

  branch: {
    checkoutHeader: 'Checkout Branch',
    statusHeader: 'Branch Status',
    createHeader: 'Create Branch',
    deleteHeader: 'Delete Branch',
    mergeHeader: 'Merge Branch',
    pushHeader: 'Push Branch',
    syncHeader: 'Sync Status',
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
};
