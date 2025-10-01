import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import sequelize from '../src/config/db.js';
import config from '../src/config/environment.js';
import { log } from '../src/utils/logger.js';

// Global test setup
beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';

    // Silence logs during tests unless explicitly needed
    if (!process.env.TEST_LOGS) {
        log.level = 'error';
    }

    try {
        // Test database connection
        await sequelize.authenticate();
        log.info('Test database connection established');

        // Sync database (use with caution in production-like environments)
        if (config.isTest) {
            await sequelize.sync({ force: true });
            log.info('Test database synchronized');
        }
    } catch (error) {
        log.error('Failed to setup test database:', error);
        throw error;
    }
});

afterAll(async () => {
    try {
        // Clean up database connections
        await sequelize.close();
        log.info('Test database connection closed');
    } catch (error) {
        log.error('Error closing test database:', error);
    }
});

beforeEach(async () => {
    // Clean database before each test
    if (config.isTest) {
        await sequelize.sync({ force: true });
    }
});

afterEach(async () => {
    // Clean up after each test if needed
    // This runs after each test case
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process in tests
});

// Global console override for cleaner test output
const originalConsole = console;
global.console = {
    ...originalConsole,
    log: process.env.TEST_LOGS ? originalConsole.log : () => {},
    info: process.env.TEST_LOGS ? originalConsole.info : () => {},
    warn: originalConsole.warn,
    error: originalConsole.error,
};