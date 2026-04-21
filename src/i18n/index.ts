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
  common: {
    skip: string;
    notSelected: string;
  };
  // setup 命令
  setup: {
    initializing: string;
    createDir: string;
    createConfig: string;
    setupComplete: string;
    nextStep: string;
    selectLanguage: string;
    chinese: string;
    english: string;
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
    // List headers
    idHeader: string;
    titleHeader: string;
    typeHeader: string;
    // Status display
    statusOpen: string;
    statusInProgress: string;
    statusWaitReview: string;
    statusWaitQa: string;
    statusWaitEvaluation: string;
    statusResolved: string;
    statusClosed: string;
    statusAbandoned: string;
    statusFailed: string;
    // Priority display
    priorityP0: string;
    priorityP1: string;
    priorityP2: string;
    priorityP3: string;
    // Task types
    typeBug: string;
    typeFeature: string;
    typeResearch: string;
    typeDocs: string;
    typeRefactor: string;
    typeTest: string;
    typeNotSpecified: string;
    // Time display
    timeJustNow: string;
    timeMinutesAgo: string;
    timeHoursAgo: string;
    timeDaysAgo: string;
    // Statistics
    totalTasks: string;
    totalSubtasks: string;
    subtasksLabel: string;
    parentTaskLabel: string;
    // Others
    dependenciesLabel: string;
    roleLabel: string;
    branchLabel: string;
    createdAt: string;
    updatedAt: string;
    reopened: string;
    reopenCount: string;
    discussionLabel: string;
    requirementChanges: string;
    // Table headers
    listTableHeader: string;
    listTableSeparator: string;
    // Checkpoint related
    checkpointsSection: string;
    noCheckpoints: string;
    checkpointProgress: string;
    // Dependencies display
    dependencyGate: string;
    dependencyError: string;
    // Task creation
    taskCreationCancelled: string;
    invalidTaskIdFormat: string;
    taskIdAlreadyExists: string;
    filteredLowQualityCheckpoints: string;
    projectNotInitialized: string;
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

  // harness executor
  harness: {
    timeoutHeader: string;
    taskDescription: string;
    dependencies: string;
    acceptanceCriteria: string;
    acceptanceCriteriaInstruction: string;
    checkpoints: string;
    checkpointsInstruction: string;
    timeoutInstruction: string;
    roleSpecificRequirements: string;
    retryContext: string;
    retryAttemptInfo: string;
    previousFailureReason: string;
    partialProgress: string;
    upstreamFailureInfo: string;
    phaseLabels: {
      development: string;
      codeReview: string;
      qa: string;
      evaluation: string;
    };
    // Console logs and reports
    logs: {
      taskLabel: string;
      typeLabel: string;
      priorityLabel: string;
      timeoutLabel: string;
      minutes: string;
      seconds: string;
      devPromptGenerated: string;
      startingHeadlessClaude: string;
      devOutputFormatRetry: string;
      devPhaseFailed: string;
      devOutputValidationFailed: string;
      devPhaseCompleted: string;
      evidenceCollected: string;
      checkpointsCompleted: string;
      devPhaseError: string;
      devPhaseNotComplete: string;
      evalTaskLabel: string;
      devStatusLabel: string;
      evalPromptGenerated: string;
      startingEvalSession: string;
      evalFormatRetry: string;
      evalEmptyOutput: string;
      evalStderrPrefix: string;
      evalParseFailureDefault: string;
      evalPassed: string;
      evalFailed: string;
      evalError: string;
      codeReviewPhase: string;
      codeReviewCheckpoints: string;
      noCodeReviewCheckpoints: string;
      codeReviewPromptGenerated: string;
      startingCodeReview: string;
      codeReviewFormatRetry: string;
      contradictionDetected: string;
      codeReviewPassed: string;
      codeReviewFailed: string;
      codeReviewError: string;
      codeReviewSessionFailed: string;
      codeReviewPromptGenerated: string;
      startingCodeReviewSession: string;
      codeReviewRetry: string;
      qaPhase: string;
      qaCheckpoints: string;
      noQACheckpoints: string;
      humanVerificationCheckpoints: string;
      deferredInfo: string;
      qaPassed: string;
      qaPassedWithHuman: string;
      qaFailed: string;
      qaError: string;
      qaSkippedDueToCodeReview: string;
      checkpointWarning: string;
      checkpointWarningDetail: string;
      checkpointWarningFallback: string;
      noAutomatedQACheckpoints: string;
      qaPromptGenerated: string;
      startingQASession: string;
      qaRetry: string;
      qaSessionFailed: string;
      qaOutputValidationFailed: string;
      cannotParseVerdict: string;
      deferredCheckpointsInfo: string;
      phantomTaskViolation: string;
      phantomTaskCriteria: string;
      phantomTaskPrefix: string;
      phantomTaskDetails: string;
      emptyOutputError: string;
      evaluationOutputEmpty: string;
      contradictionFix: string;
      evalParseError: string;
      evalParseFailureDefaultReason: string;
      phantomTaskDetected: string;
      phantomTaskAutoNopass: string;
      noPhantomTask: string;
      snapshotMode: string;
      fallbackMode: string;
      snapshotStats: string;
      snapshotError: string;
      snapshotExcludedInfo: string;
      snapshotBasedOnInfo: string;
      hookWarningIgnored: string;
      hookErrorNoOutput: string;
      processExitCode: string;
      creatingCommandWarning: string;
      creatingCommandIntent: string;
      parseErrorWarning: string;
      rawOutputSaved: string;
      saveRawOutputFailed: string;
      rawEvaluationOutputTitle: string;
      structuredMatchPassed: string;
      structuredMatchFailed: string;
      cannotParseResult: string;
      contractDataInvalid: string;
      contractParseFailed: string;
      exitCode: string;
      devOutputValidationFailedError: string;
      retryReference: string;
      apiRetry: string;
      retryingInSeconds: string;
      archivedReport: string;
      archiveFailed: string;
      maxRetriesReached: string;
      preparingRetry: string;
      waitingToRetry: string;
      // Verification related
      verificationCommands: string;
      verificationSteps: string;
      expectedResult: string;
      suggestedVerificationSteps: string;
      fallbackVerificationCommands: string;
      runVerificationCommands: string;
      // Retry context for code review
      previousReviewFailureReason: string;
      previousCodeReviewFailed: string;
      ensureFixesCover: string;
      // Developer changes and evidence
      developerDeclaredChanges: string;
      submittedEvidence: string;
      submittedEvidenceTitle: string;
      developerSubmittedEvidence: string;
      developerCompletedCheckpoints: string;
      // Retry context for QA
      previousQAFailureReason: string;
      previousQAVerificationFailed: string;
      pleaseNote: string;
      reviewPreviousFailure: string;
      formalRequirementFix: string;
      realIssuePersist: string;
      // Upstream failure info
      upstreamTask: string;
      failureTime: string;
      retryReferenceNote: string;
    };
    reports: {
      devReportTitle: string;
      reviewReportTitle: string;
      codeReviewReportTitle: string;
      qaReportTitle: string;
      statusLabel: string;
      startTimeLabel: string;
      endTimeLabel: string;
      durationLabel: string;
      errorInfoSection: string;
      codeChangesSection: string;
      evidenceFilesSection: string;
      completedCheckpointsSection: string;
      claudeOutputSection: string;
      resultLabel: string;
      reviewedAtLabel: string;
      reviewedByLabel: string;
      inferenceTypeLabel: string;
      reasonSection: string;
      failedCriteriaSection: string;
      failedCheckpointsSection: string;
      detailsSection: string;
      devPhaseInfoSection: string;
      evidenceCountLabel: string;
      checkpointsCountLabel: string;
      codeQualityIssuesSection: string;
      testFailuresSection: string;
      humanVerificationSection: string;
      humanVerificationNote: string;
      requiresHumanLabel: string;
      yes: string;
      no: string;
      inferenceTypes: {
        structuredMatch: string;
        explicitMatch: string;
        contentInference: string;
        priorStageInference: string;
        parseFailureDefault: string;
        emptyOutput: string;
      };
    };
  };

  // analyze-fix-pipeline command
  analyzeFixPipeline: {
    fixPipelineMode: string;
    executingStages: string;
    stage1Analysis: string;
    stage1Complete: string;
    stage1Failed: string;
    stage1Skipped: string;
    stage2Fix: string;
    stage2FixWithAnalysis: string;
    stage2Complete: string;
    stage2Failed: string;
    stage2Skipped: string;
    stage3AI: string;
    stage3Complete: string;
    stage3Failed: string;
    stage3Skipped: string;
    stage3NotEnabled: string;
    stage4Checkpoint: string;
    stage4Complete: string;
    stage4Failed: string;
    stage4Skipped: string;
    stage5Quality: string;
    stage5Complete: string;
    stage5Failed: string;
    stage5Skipped: string;
    pipelineComplete: string;
    noIssuesFound: string;
    autoFixIssues: string;
    nonInteractiveMode: string;
    fixError: string;
    fixComplete: string;
    fixSkipped: string;
    fixUnfixable: string;
    autoClosingStale: string;
    skipStale: string;
    checkingStale: string;
    closingTask: string;
    markingInProgress: string;
    skipNoDescription: string;
    checkingNoDescription: string;
    addingDescription: string;
    analyzingCycle: string;
    cycleNotFound: string;
    breakingCycle: string;
    cycleManualFix: string;
    fixingPriority: string;
    priorityUpdated: string;
    fixingStatus: string;
    statusUpdated: string;
    fixingSchema: string;
    reopenCountAdded: string;
    requirementHistoryAdded: string;
    fixingEmptyArrays: string;
    arrayInitialized: string;
    migratingPipelineStatus: string;
    statusMigrated: string;
    cannotDetermineTargetStatus: string;
    fixingVerdictAction: string;
    verdictActionCleared: string;
    migratingSchema: string;
    fixingCreatedBy: string;
    createdByAdded: string;
    fixingInvalidStatus: string;
    fixingInvalidType: string;
    typeUpdated: string;
    fixingInvalidPriority: string;
    fixingReopenTransition: string;
    transitionNoteAdded: string;
    fixingStatusContradiction: string;
    statusContradictionFixed: string;
    fixingTimestamp: string;
    timestampUpdated: string;
    invalidParent: string;
    fixingSubtaskRef: string;
    subtaskRefRemoved: string;
    fixingDependencyRef: string;
    dependencyRefRemoved: string;
    inferringDependencies: string;
    inferredDepNotFound: string;
    inferredDepWouldCreateCycle: string;
    inferredDepAdded: string;
    fixingParentRef: string;
    parentRefAdded: string;
    fixingParentChildRelation: string;
    parentChildRelationFixed: string;
    cannotExtractKeywords: string;
    generatedIdSame: string;
    renamingTask: string;
    taskRenamed: string;
    renameFailed: string;
    cannotAutoFix: string;
    suggestion: string;
    fixingManualVerification: string;
    manualToAutomated: string;
    fixingMissingVerification: string;
    verificationAutoFilled: string;
    checkpointCompletionRate: string;
    cleaningAbandonedTasks: string;
    abandonedTaskDeleted: string;
    cleaningOrphanTasks: string;
    checkingAbandoned: string;
    abandonedFound: string;
    missingFileRef: string;
    missingFiles: string;
    fillingTransitionNote: string;
    missingHistoryDetail: string;
    transitionNoteFilled: string;
    missingSuggestion: string;
    fixingInterruptedTask: string;
    currentStatus: string;
    suggestedStatus: string;
    reason: string;
    skipKeepInProgress: string;
    statusFixed: string;
    migratingReopenedStatus: string;
    reopenedMigrated: string;
    migratingNeedsHumanStatus: string;
    needsHumanMigrated: string;
    checkpointCoverageWarning: string;
    tasksWithoutCheckpoints: string;
    currentCoverage: string;
    lowQualityTask: string;
    score: string;
    cleaningObsoleteStatus: string;
    obsoleteStatusCleaned: string;
    missingInferenceInfo: string;
    fixingReportStatusMismatch: string;
    reportStatusMismatchFixed: string;
    fixingCheckpointStatusMismatch: string;
    checkpointStatusMismatchFixed: string;
    unknownFixAction: string;
    resettingTask: string;
    taskReset: string;
    unsupportedRule: string;
    fixingCheckpointPrefix: string;
    noCheckpoints: string;
    checkpointPrefixUpdated: string;
    allCheckpointsHavePrefix: string;
  };

  // task command additional keys
  taskCommand: {
    checkpointQualityReminder: string;
    taskCreatedButTemplate: string;
    highQualityCheckpointsEssential: string;
    editCheckpointMd: string;
    filePath: string;
    useAnalyzeCommand: string;
    useTemplateFeature: string;
    tipStrictValidation: string;
    missingCheckpointVerificationCommands: string;
    checkpointsMissingVerification: string;
    qaCannotAutoVerify: string;
    validationError: string;
    checkpointFileNotExist: string;
    noCheckpointItems: string;
    templateContentDetected: string;
    titleCannotBeEmpty: string;
  };

  // init-requirement command additional keys
  initRequirementCmd: {
    complexityWarning: string;
    complexityHigh: string;
    exceedsTimeout: string;
    dependsOn: string;
    files: string;
    estimated: string;
    qualityGateFailed: string;
    errorViolations: string;
    followingErrorsMustFix: string;
    fixSuggestions: string;
    checkpointPrefixTip: string;
    metaJsonFormatTip: string;
    skipQualityGateTip: string;
    qualityGateLowScore: string;
    qualityGateImprovement: string;
    action: string;
  };

  // setup command
  setupCmd: {
    alreadyInitialized: string;
    directory: string;
    tipUseForce: string;
    forceMode: string;
    gitHookCreated: string;
    gitHookFailed: string;
    gitHookDisabled: string;
    copySkillFile: string;
    copyCommandDocs: string;
    copyDefault: string;
    fileNotFound: string;
    dirNotFound: string;
    pluginRootNotSet: string;
  };

  // harness command
  harnessCmd: {
    projectNotInitialized: string;
    concurrentPipelineRunning: string;
    activePipelineInfo: string;
    snapshotId: string;
    processId: string;
    createdAt: string;
    taskCount: string;
    possibleCauses: string;
    solutions: string;
    invalidMaxRetries: string;
    invalidTimeout: string;
    invalidParallel: string;
    noExecutableTasks: string;
    batchLabel: string;
    parallelTag: string;
    dryRunComplete: string;
    qualityGateCheck: string;
    minQualityScoreThreshold: string;
    qualityGateFailed: string;
    tasksNeedImprovement: string;
    allTasksPassed: string;
    resumingFromInterruption: string;
    noPreviousState: string;
    stateFileMigrated: string;
    loadingStateFailed: string;
    cleaningOrphanSnapshots: string;
    cleanedSnapshots: string;
    forceCleanedSnapshots: string;
    noSnapshotsFound: string;
  };

  // doctor command
  doctorCmd: {
    environmentDiagnostics: string;
    autoFix: string;
    reChecking: string;
    useFixToAutoFix: string;
    summary: string;
    allChecksPassed: string;
    fixing: string;
    copiedSkillMd: string;
    copiedCommandDocs: string;
    cannotFixPluginRootNotFound: string;
    createdDirectory: string;
    createdLogsDirectory: string;
    autoFilledMissingConfig: string;
    migratedDeprecatedStatusTasks: string;
    cleanedDeprecatedHookConfig: string;
    updatedSettings: string;
    deletedDeprecatedScripts: string;
    fixComplete: string;
    bugReportGeneration: string;
    errorProjectNotInitialized: string;
    runSetupFirst: string;
    aiCostSummary: string;
    totalAiCalls: string;
    totalDuration: string;
    totalTokens: string;
    byField: string;
    fieldStats: string;
    usageAnalysis: string;
    totalCommandExecutions: string;
    averageDuration: string;
    aiUsageRate: string;
    errorsAndWarnings: string;
    commandFrequency: string;
    commandCount: string;
    commonErrors: string;
    errorEntry: string;
    bugReportGenerated: string;
    logArchive: string;
    bugReportFailed: string;
    deepLogAnalysis: string;
    noLogFilesFound: string;
    logDirectory: string;
    logFilesCount: string;
    logEntriesCount: string;
    noLogEntriesInLast24Hours: string;
    registeredAnalyzers: string;
    analyzerEntry: string;
    foundIssues: string;
    criticalIssuesRequireAttention: string;
    errorsNeedAttention: string;
    deepAnalysisComplete: string;
    // Check results
    checkProjectInit: string;
    checkProjectInitNotInitialized: string;
    checkProjectInitRunSetup: string;
    checkProjectInitInitialized: string;
    checkPluginCache: string;
    checkPluginCacheNormal: string;
    checkPluginCacheCliMode: string;
    checkPluginCacheMainFileMissing: string;
    checkPluginCacheLocalesMissing: string;
    checkPluginCacheCommandsMissing: string;
    checkSkillFiles: string;
    checkSkillFilesCount: string;
    checkSkillFilesMissing: string;
    checkSkillFilesReRunSetup: string;
    checkDirectoryStructure: string;
    checkDirectoryMissing: string;
    checkDirectoryExists: string;
    checkArchiveMissing: string;
    checkPluginScope: string;
    checkPluginScopeWarning: string;
    checkPluginScopeRecommendUserScope: string;
    checkLogDirectory: string;
    checkLogDirectoryMissing: string;
    checkLogDirectoryExists: string;
    checkLogConfigCompleteness: string;
    checkLogConfigMissing: string;
    checkLogConfigComplete: string;
    checkAiConfigCompleteness: string;
    checkAiConfigMissing: string;
    checkTrainingConfigCompleteness: string;
    checkTrainingConfigMissing: string;
    checkLogHealth: string;
    checkLogHealthOversized: string;
    checkLogHealthTotalSize: string;
    checkDeprecatedStatus: string;
    checkDeprecatedStatusOk: string;
    checkDeprecatedStatusFound: string;
    checkGitHooks: string;
    checkGitHooksDisabled: string;
    checkGitHooksNotGitRepo: string;
    checkGitHooksInstalled: string;
    checkGitHooksNotInstalled: string;
    checkDeprecatedHooks: string;
    checkDeprecatedHooksFound: string;
    checkDeprecatedHooksOk: string;
  };

  // analyze command
  analyzeCmd: {
    projectNotInitialized: string;
    analyzingProject: string;
    analysisComplete: string;
    issuesFound: string;
    noIssues: string;
    fixApplied: string;
    taskIdEmpty: string;
    taskIdFormatInvalid: string;
    historyEntryNotObject: string;
    timestampMissing: string;
    timestampInvalid: string;
    actionMissing: string;
    checkpointNotObject: string;
    checkpointIdMissing: string;
    checkpointStatusInvalid: string;
    // Schema migration
    schemaMigrationReopenCount: string;
    schemaMigrationRequirementHistory: string;
    schemaMigrationCommitHistory: string;
    schemaMigrationTransitionNotes: string;
    schemaMigrationResumeAction: string;
    schemaMigrationCheckpointPrefix: string;
    schemaMigrationCheckpointPolicy: string;
    // AI prompt
    aiPromptTaskInfo: string;
    aiPromptHistory: string;
    aiPromptTransitionHistory: string;
    aiPromptCheckpoints: string;
    aiPromptVerification: string;
    aiPromptLayer1Results: string;
    aiPromptNoHistory: string;
    aiPromptNoTransitionHistory: string;
    aiPromptNoCheckpoints: string;
    aiPromptNoVerification: string;
    aiPromptNoLayer1Issues: string;
    aiPromptTaskAnalysisExpert: string;
    aiPromptAnalyzeContext: string;
    aiPromptJsonFormat: string;
    aiPromptInferredStatus: string;
    aiPromptConfidence: string;
    aiPromptReasoning: string;
    aiPromptSuggestion: string;
    // Issue messages
    issueMissingDescription: string;
    issueResolvedNoVerification: string;
    issueOldFormatId: string;
    issueMissingSlug: string;
    // Transition labels
    transitionStartExecution: string;
    transitionSubmitReview: string;
    transitionReviewPass: string;
    transitionQaPass: string;
    transitionEvalPass: string;
    transitionCloseTask: string;
    transitionDirectComplete: string;
    transitionReopenTask: string;
    transitionRestartExecution: string;
    transitionAbandonTask: string;
    transitionReturnTodo: string;
    // Status suggestions
    statusSuggestionCheckpointRate: string;
    statusSuggestionKeepInProgress: string;
    statusSuggestionResetOpen: string;
    // Dependency suggestions
    depSuggestionCheckIndependence: string;
    depSuggestionIndependentModule: string;
    // Common
    unknown: string;
    none: string;
    // Report parsing
    reportResultPass: string;
    reportResultNopass: string;
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
