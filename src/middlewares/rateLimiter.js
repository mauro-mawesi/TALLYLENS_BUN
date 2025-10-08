import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import config from '../config/environment.js';
import { log } from '../utils/logger.js';

// Helper function to create rate limiters
const createRateLimiter = (options) => {
    return rateLimit({
        windowMs: options.windowMs || config.rateLimit.windowMs,
        max: options.max || config.rateLimit.maxRequests,
        message: {
            status: 'error',
            message: options.message || 'Too many requests from this IP, please try again later.'
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            log.warn('Rate limit exceeded', {
                ip: req.ip,
                userAgent: req.get('user-agent'),
                path: req.path,
                method: req.method
            });

            res.status(429).json({
                status: 'error',
                message: 'Too many requests from this IP, please try again later.',
                retryAfter: Math.round(options.windowMs / 1000)
            });
        },
        ...options
    });
};

// General API rate limiter
export const generalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // 300 requests per 15 minutes (increased for mobile apps with multiple simultaneous calls)
    message: 'Too many requests from this IP, please try again later.'
});

// Strict rate limiter for authentication routes
export const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: 'Too many authentication attempts from this IP, please try again later.',
    skipSuccessfulRequests: true // Don't count successful requests
});

// Password reset rate limiter
export const passwordResetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset attempts per hour
    message: 'Too many password reset requests from this IP, please try again later.'
});

// File upload rate limiter
export const uploadLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 file uploads per 15 minutes
    message: 'Too many file uploads from this IP, please try again later.'
});

// OCR processing rate limiter
export const ocrLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 OCR requests per minute
    message: 'Too many OCR processing requests, please try again later.'
});

// Email verification rate limiter
export const emailVerificationLimiter = createRateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5, // 5 email verification attempts per day
    message: 'Too many email verification requests from this IP, please try again tomorrow.'
});

// Helper function for user-specific rate limiting (safe for IPv6)
const createUserKeyGenerator = (req) => {
    // Use user ID if authenticated, otherwise fall back to IP with IPv6 support
    if (req.user?.id) {
        return `user:${req.user.id}`;
    }
    return ipKeyGenerator(req);
};

// User-specific rate limiter for receipts
export const userReceiptLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 200, // 200 receipt operations per hour per user
    message: 'Too many receipt operations for your account, please try again later.',
    keyGenerator: createUserKeyGenerator
});

// User-specific rate limiter for general API calls (more generous for authenticated users)
export const userApiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per 15 minutes per authenticated user
    message: 'Too many API requests for your account, please try again later.',
    keyGenerator: createUserKeyGenerator
});

// Progressive rate limiting (stricter limits for higher usage)
export const progressiveRateLimiter = (baseOptions) => {
    const limiters = [
        createRateLimiter({
            ...baseOptions,
            max: baseOptions.max,
            windowMs: baseOptions.windowMs
        }),
        createRateLimiter({
            ...baseOptions,
            max: Math.floor(baseOptions.max * 0.5),
            windowMs: baseOptions.windowMs * 2
        }),
        createRateLimiter({
            ...baseOptions,
            max: Math.floor(baseOptions.max * 0.25),
            windowMs: baseOptions.windowMs * 4
        })
    ];

    return (req, res, next) => {
        const runLimiter = (index) => {
            if (index >= limiters.length) {
                return next();
            }

            limiters[index](req, res, (err) => {
                if (err) {
                    return next(err);
                }

                if (res.headersSent) {
                    return; // Rate limit hit
                }

                runLimiter(index + 1);
            });
        };

        runLimiter(0);
    };
};