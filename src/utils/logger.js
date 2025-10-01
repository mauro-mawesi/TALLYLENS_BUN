import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import config from '../config/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure log directory exists
const logDir = path.join(__dirname, '../../', config.logging.directory);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'blue',
    silly: 'grey'
};

winston.addColors(colors);

// Format for console output
const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.align(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}]: ${message} ${metaString}`;
    })
);

// Format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Create transports
const transports = [];

// Console transport (only in development)
if (config.isDevelopment) {
    transports.push(
        new winston.transports.Console({
            format: consoleFormat,
            level: config.logging.level
        })
    );
}

// Error file transport (rotated daily)
transports.push(
    new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: fileFormat,
        maxFiles: '30d',
        maxSize: '20m'
    })
);

// Combined file transport (rotated daily)
transports.push(
    new DailyRotateFile({
        filename: path.join(logDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: fileFormat,
        maxFiles: '14d',
        maxSize: '20m'
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: config.logging.level,
    levels,
    transports,
    exitOnError: false
});

// Create a stream object for Morgan
logger.stream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

// Export wrapper functions for easier use
export const log = {
    error: (message, meta = {}) => logger.error(message, meta),
    warn: (message, meta = {}) => logger.warn(message, meta),
    info: (message, meta = {}) => logger.info(message, meta),
    http: (message, meta = {}) => logger.http(message, meta),
    verbose: (message, meta = {}) => logger.verbose(message, meta),
    debug: (message, meta = {}) => logger.debug(message, meta),

    // Log with context
    withContext: (context) => ({
        error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
        warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
        info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
        debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta }),
    }),

    // Performance logging
    startTimer: () => {
        const start = Date.now();
        return {
            done: (message, meta = {}) => {
                const duration = Date.now() - start;
                logger.info(message, { duration, ...meta });
            }
        };
    },

    // Request logging
    logRequest: (req, res, responseTime) => {
        logger.http('HTTP Request', {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            responseTime: `${responseTime}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    }
};

export default logger;