import helmet from 'helmet';
import compression from 'compression';
import config from '../config/environment.js';
import { log } from '../utils/logger.js';

// Enhanced security headers with Helmet
export const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https:"],
            fontSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: config.isProduction ? [] : null,
        },
    },
    crossOriginEmbedderPolicy: false, // Disable for API
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    },
    referrerPolicy: {
        policy: "strict-origin-when-cross-origin"
    }
});

// Compression middleware
export const compressionMiddleware = compression({
    level: 6,
    threshold: 1024, // Only compress if response is larger than 1KB
    filter: (req, res) => {
        // Don't compress responses with this request header
        if (req.headers['x-no-compression']) {
            return false;
        }
        // Fall back to standard filter function
        return compression.filter(req, res);
    }
});

// Request size limits
export const requestSizeLimits = (req, res, next) => {
    // Set specific limits based on content type
    if (req.is('application/json')) {
        req.on('data', (chunk) => {
            if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 1024 * 1024) { // 1MB
                const error = new Error('Request entity too large');
                error.status = 413;
                return next(error);
            }
        });
    }
    next();
};

// IP whitelist/blacklist middleware
export const ipFilter = (req, res, next) => {
    const clientIp = req.ip;

    // Blacklisted IPs (could come from database or config)
    const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];

    if (blacklistedIPs.includes(clientIp)) {
        log.warn('Blocked request from blacklisted IP', { ip: clientIp });
        return res.status(403).json({
            status: 'error',
            message: 'Access denied'
        });
    }

    // Log suspicious patterns
    const suspiciousPatterns = [
        /sqlmap/i,
        /nmap/i,
        /nikto/i,
        /burp/i,
        /acunetix/i
    ];

    const userAgent = req.get('user-agent') || '';
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));

    if (isSuspicious) {
        log.warn('Suspicious user agent detected', {
            ip: clientIp,
            userAgent,
            path: req.path
        });
    }

    next();
};

// Request ID middleware for tracking
export const requestId = (req, res, next) => {
    req.id = Math.random().toString(36).substr(2, 9);
    res.setHeader('X-Request-ID', req.id);
    next();
};

// Hide sensitive information in responses
export const hideSensitiveData = (req, res, next) => {
    // Remove X-Powered-By header
    res.removeHeader('X-Powered-By');

    // Add custom headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    next();
};

// CORS configuration
export const corsConfig = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, postman, etc.)
        if (!origin) return callback(null, true);

        const allowedOrigins = config.cors.origin === '*'
            ? [origin]
            : config.cors.origin.split(',');

        if (allowedOrigins.includes(origin) || config.isDevelopment) {
            callback(null, true);
        } else {
            log.warn('CORS blocked request', { origin });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-Request-ID'
    ],
    exposedHeaders: ['X-Request-ID', 'X-Total-Count']
};

// Request logging for security monitoring
export const securityLogger = (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const logData = {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            status: res.statusCode,
            duration,
            contentLength: res.get('content-length'),
            requestId: req.id
        };

        // Log security events
        if (res.statusCode >= 400) {
            log.warn('HTTP Error Response', logData);
        }

        // Log slow requests
        if (duration > 5000) {
            log.warn('Slow Request', logData);
        }

        // Log large responses
        const contentLength = parseInt(res.get('content-length') || '0');
        if (contentLength > 10 * 1024 * 1024) { // 10MB
            log.warn('Large Response', logData);
        }
    });

    next();
};

// Prevent parameter pollution
export const preventParameterPollution = (req, res, next) => {
    // Convert array parameters to single values (take the last one)
    for (const key in req.query) {
        if (Array.isArray(req.query[key])) {
            req.query[key] = req.query[key][req.query[key].length - 1];
        }
    }
    next();
};

// Content type validation
export const validateContentType = (allowedTypes) => {
    return (req, res, next) => {
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const contentType = req.get('content-type');

            if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
                return res.status(415).json({
                    status: 'error',
                    message: 'Unsupported Media Type'
                });
            }
        }
        next();
    };
};