import joi from 'joi';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Define validation schema
const envSchema = joi.object({
    // Server
    NODE_ENV: joi.string().valid('development', 'test', 'staging', 'production').default('development'),
    PORT: joi.number().positive().default(3000),

    // Database
    DATABASE_URL: joi.string().required().description('PostgreSQL connection string'),
    DB_LOGGING: joi.boolean().default(false),
    DB_SSL: joi.boolean().default(true),

    // External APIs
    OPENROUTER_API_KEY: joi.string().required().description('OpenRouter API key for AI categorization'),
    GOOGLE_APPLICATION_CREDENTIALS: joi.string().description('Path to Google Cloud credentials JSON'),
    FIREBASE_SERVICE_ACCOUNT: joi.string().optional().description('Path to Firebase service account JSON'),

    // Security
    JWT_SECRET: joi.string().min(32).required().description('Secret for JWT token generation'),
    JWT_REFRESH_SECRET: joi.string().min(32).required().description('Secret for JWT refresh token'),
    JWT_EXPIRATION: joi.string().default('15m'),
    JWT_REFRESH_EXPIRATION: joi.string().default('7d'),
    BCRYPT_ROUNDS: joi.number().min(10).default(12),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: joi.number().default(15 * 60 * 1000), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: joi.number().default(100),

    // File Upload
    MAX_FILE_SIZE: joi.number().default(5 * 1024 * 1024), // 5MB
    ALLOWED_FILE_TYPES: joi.string().default('image/jpeg,image/png,image/jpg'),
    UPLOAD_DIR: joi.string().default('uploads'),

    // Redis (optional for caching)
    REDIS_HOST: joi.string().optional(),
    REDIS_PORT: joi.number().optional(),
    REDIS_USERNAME: joi.string().optional(),
    REDIS_PASSWORD: joi.string().optional(),
    REDIS_TLS: joi.boolean().default(false),
    REDIS_URL: joi.string().optional(),
    CACHE_TTL: joi.number().default(3600), // 1 hour

    // Logging
    LOG_LEVEL: joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),
    LOG_DIR: joi.string().default('logs'),

    // CORS
    CORS_ORIGIN: joi.string().default('*'),

    // Session
    SESSION_SECRET: joi.string().min(32).when('NODE_ENV', { is: 'production', then: joi.required(), otherwise: joi.optional().default('dev-session-secret') }),

    // Monitoring
    SENTRY_DSN: joi.string().optional(),
    NEW_RELIC_LICENSE_KEY: joi.string().optional(),

}).unknown(); // Allow additional env vars

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
    throw new Error(`Environment validation error: ${error.message}`);
}

// Export validated and typed configuration
export const config = {
    env: envVars.NODE_ENV,
    isDevelopment: envVars.NODE_ENV === 'development',
    isProduction: envVars.NODE_ENV === 'production',
    isTest: envVars.NODE_ENV === 'test',

    server: {
        port: envVars.PORT,
    },

    database: {
        url: envVars.DATABASE_URL,
        logging: envVars.DB_LOGGING,
        ssl: envVars.DB_SSL,
    },

    apis: {
        openRouter: {
            apiKey: envVars.OPENROUTER_API_KEY,
        },
        googleCloud: {
            credentials: envVars.GOOGLE_APPLICATION_CREDENTIALS,
        },
    },

    firebase: {
        serviceAccount: envVars.FIREBASE_SERVICE_ACCOUNT
            ? JSON.parse(readFileSync(envVars.FIREBASE_SERVICE_ACCOUNT, 'utf8'))
            : null,
    },

    security: {
        jwt: {
            secret: envVars.JWT_SECRET,
            refreshSecret: envVars.JWT_REFRESH_SECRET,
            expiration: envVars.JWT_EXPIRATION,
            refreshExpiration: envVars.JWT_REFRESH_EXPIRATION,
        },
        bcrypt: {
            rounds: envVars.BCRYPT_ROUNDS,
        },
        session: {
            secret: envVars.SESSION_SECRET,
        },
    },

    rateLimit: {
        windowMs: envVars.RATE_LIMIT_WINDOW_MS,
        maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
    },

    upload: {
        maxFileSize: envVars.MAX_FILE_SIZE,
        allowedTypes: envVars.ALLOWED_FILE_TYPES.split(','),
        directory: envVars.UPLOAD_DIR,
    },

    redis: {
        host: envVars.REDIS_HOST,
        port: envVars.REDIS_PORT,
        username: envVars.REDIS_USERNAME,
        password: envVars.REDIS_PASSWORD,
        tls: envVars.REDIS_TLS,
        url: envVars.REDIS_URL || (envVars.REDIS_HOST
            ? `redis${envVars.REDIS_TLS ? 's' : ''}://${envVars.REDIS_USERNAME ? envVars.REDIS_USERNAME + ':' : ':'}${envVars.REDIS_PASSWORD}@${envVars.REDIS_HOST}:${envVars.REDIS_PORT}`
            : null),
        cacheTtl: envVars.CACHE_TTL,
    },

    logging: {
        level: envVars.LOG_LEVEL,
        directory: envVars.LOG_DIR,
    },

    cors: {
        origin: envVars.CORS_ORIGIN,
    },

    monitoring: {
        sentryDsn: envVars.SENTRY_DSN,
        newRelicKey: envVars.NEW_RELIC_LICENSE_KEY,
    },
};

export default config;