/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': '@swc/jest',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
  maxConcurrency: 1,
  workerIdleMemoryLimit: 400,
  forceExit: true,
  detectOpenHandles: true,
};
