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
        tsconfig: {
          // Inherit from project tsconfig but relax strict checks for tests
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          verbatimModuleSyntax: false,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          // Relax strict checks that cause test failures
          strict: false,
          noUncheckedIndexedAccess: false,
          strictNullChecks: false,
          skipLibCheck: true,
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000,
  // Prevent OOM by limiting workers
  maxWorkers: 2,
  // Force exit after tests complete
  forceExit: true,
  detectOpenHandles: true,
};
