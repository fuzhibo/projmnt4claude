/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // Key: isolatedModules=true makes ts-jest transpile only (no type checking)
        // This matches Bun's behavior - fast transpile without full type validation
        isolatedModules: true,
        tsconfig: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          verbatimModuleSyntax: false,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // PLAN-04-02: investigation.test.ts causes OOM due to headless-agent dependency chain
    // ts-jest memory explodes when compiling this file (4GB+ heap not enough)
    // Root cause: ai-integration → headless-agent → harness-helpers heavy module chain
    // TODO: Fix by mocking headless-agent at module level or refactoring dependency structure
    'src/utils/investigation/__tests__/investigation.test.ts',
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000,
  // Memory control: use worker recycling to prevent OOM
  // Each test file runs in a worker process; workers exceeding memory limit are recycled
  maxWorkers: 3,
  maxConcurrency: 3,
  // Automatically restart workers that exceed this memory (MB)
  workerIdleMemoryLimit: 800,
  forceExit: true,
  detectOpenHandles: true,
};
