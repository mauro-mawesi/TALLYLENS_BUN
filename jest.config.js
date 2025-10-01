export default {
    // Test environment
    testEnvironment: 'node',

    // ES modules support
    preset: 'jest-preset-esm',
    extensionsToTreatAsEsm: ['.js'],
    transform: {},

    // Test file patterns
    testMatch: [
        '**/__tests__/**/*.js',
        '**/?(*.)+(spec|test).js'
    ],

    // Coverage configuration
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/*.test.js',
        '!src/**/*.spec.js',
        '!src/database/migrations/**',
        '!src/database/seeders/**'
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70
        }
    },

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Module paths
    moduleDirectories: ['node_modules', 'src'],

    // Clear mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Timeout
    testTimeout: 30000,

    // Verbose output
    verbose: true,

    // Exit on first test failure in CI
    bail: process.env.CI ? 1 : 0,

    // Global variables
    globals: {
        'ts-jest': {
            useESM: true
        }
    }
};