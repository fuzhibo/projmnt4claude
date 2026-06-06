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
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000,
  // Memory control: single worker to prevent memory accumulation
  maxWorkers: 1,
  // Reduce memory by not running tests in parallel
  maxConcurrency: 1,
  forceExit: true,
  detectOpenHandles: true,
};
