import sequelize from '../config/db.js';
import { log } from '../utils/logger.js';
import { asyncHandler } from '../utils/errors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json without import assertion
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

// Basic health check
export const healthCheck = asyncHandler(async (req, res) => {
    const healthInfo = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: pkg.version,
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
    };

    res.json({
        status: 'success',
        data: healthInfo
    });
});

// Detailed health check with dependencies
export const detailedHealthCheck = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const checks = {};

    // Database health check
    try {
        const dbStart = Date.now();
        await sequelize.authenticate();
        checks.database = {
            status: 'UP',
            responseTime: `${Date.now() - dbStart}ms`,
            message: 'Database connection successful'
        };
    } catch (error) {
        checks.database = {
            status: 'DOWN',
            message: error.message
        };
    }

    // Memory check
    const memoryUsage = process.memoryUsage();
    const memoryStatus = memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9 ? 'WARNING' : 'UP';
    checks.memory = {
        status: memoryStatus,
        usage: {
            used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
            percentage: `${Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)}%`
        }
    };

    // Disk space check (simplified)
    checks.diskSpace = {
        status: 'UP',
        message: 'Disk space monitoring not implemented'
    };

    // External services health check
    checks.externalServices = {
        googleCloudVision: await checkGoogleCloudVision(),
        openRouter: await checkOpenRouter()
    };

    // Overall status
    const allStatuses = Object.values(checks).flatMap(check =>
        typeof check.status === 'string' ? [check.status] : Object.values(check).map(subCheck => subCheck.status)
    );

    const overallStatus = allStatuses.includes('DOWN') ? 'DOWN' :
                         allStatuses.includes('WARNING') ? 'WARNING' : 'UP';

    const healthInfo = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        responseTime: `${Date.now() - startTime}ms`,
        version: pkg.version,
        environment: process.env.NODE_ENV || 'development',
        uptime: `${Math.floor(process.uptime())}s`,
        checks
    };

    const statusCode = overallStatus === 'DOWN' ? 503 : 200;

    res.status(statusCode).json({
        status: overallStatus === 'DOWN' ? 'error' : 'success',
        data: healthInfo
    });
});

// Liveness probe - simple check that the app is running
export const liveness = asyncHandler(async (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
    });
});

// Readiness probe - check if app is ready to receive traffic
export const readiness = asyncHandler(async (req, res) => {
    const checks = {};

    // Check database connectivity
    try {
        await sequelize.authenticate();
        checks.database = 'UP';
    } catch (error) {
        checks.database = 'DOWN';
        log.error('Readiness check failed - Database not available:', error);
        return res.status(503).json({
            status: 'not_ready',
            message: 'Database not available',
            checks
        });
    }

    // Check critical environment variables
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingEnvVars.length > 0) {
        checks.environment = 'DOWN';
        return res.status(503).json({
            status: 'not_ready',
            message: `Missing required environment variables: ${missingEnvVars.join(', ')}`,
            checks
        });
    }

    checks.environment = 'UP';

    res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks
    });
});

// Metrics endpoint for monitoring systems
export const metrics = asyncHandler(async (req, res) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metrics = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
        },
        eventLoop: {
            delay: await getEventLoopDelay()
        },
        gc: getGCStats()
    };

    res.json({
        status: 'success',
        data: metrics
    });
});

// Helper functions for external service checks
async function checkGoogleCloudVision() {
    try {
        // Simple check - you might want to make an actual API call
        const hasCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        return {
            status: hasCredentials ? 'UP' : 'WARNING',
            message: hasCredentials ? 'Credentials configured' : 'No credentials configured'
        };
    } catch (error) {
        return {
            status: 'DOWN',
            message: error.message
        };
    }
}

async function checkOpenRouter() {
    try {
        const hasApiKey = process.env.OPENROUTER_API_KEY;
        return {
            status: hasApiKey ? 'UP' : 'WARNING',
            message: hasApiKey ? 'API key configured' : 'No API key configured'
        };
    } catch (error) {
        return {
            status: 'DOWN',
            message: error.message
        };
    }
}

// Get event loop delay
function getEventLoopDelay() {
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        setImmediate(() => {
            const delta = process.hrtime.bigint() - start;
            resolve(Number(delta / 1000000n)); // Convert to milliseconds
        });
    });
}

// Get garbage collection stats
function getGCStats() {
    try {
        return {
            heapSizeLimit: v8.getHeapStatistics?.()?.heap_size_limit || 'N/A'
        };
    } catch (error) {
        return {
            error: 'GC stats not available'
        };
    }
}

// Performance monitoring
export const performance = asyncHandler(async (req, res) => {
    const performanceData = {
        timestamp: new Date().toISOString(),
        processMetrics: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            pid: process.pid,
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version
        },
        systemMetrics: {
            loadAverage: require('os').loadavg(),
            freeMemory: require('os').freemem(),
            totalMemory: require('os').totalmem(),
            networkInterfaces: Object.keys(require('os').networkInterfaces())
        }
    };

    res.json({
        status: 'success',
        data: performanceData
    });
});