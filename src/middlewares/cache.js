import cacheService from '../services/cacheService.js';
import { log } from '../utils/logger.js';
import crypto from 'crypto';

// Generic cache middleware
export const cache = (options = {}) => {
    const {
        ttl = 3600, // 1 hour default
        keyGenerator = null,
        condition = null,
        exclude = []
    } = options;

    return async (req, res, next) => {
        // Skip caching for non-GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Skip if condition is not met
        if (condition && !condition(req)) {
            return next();
        }

        // Skip for excluded paths
        if (exclude.some(path => req.path.includes(path))) {
            return next();
        }

        try {
            // Generate cache key
            let cacheKey;
            if (keyGenerator) {
                cacheKey = keyGenerator(req);
            } else {
                const keyData = {
                    path: req.path,
                    query: req.query,
                    userId: req.user?.id || 'anonymous'
                };
                cacheKey = `api:${crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex')}`;
            }

            // Try to get cached response
            const cachedResponse = await cacheService.get(cacheKey);
            if (cachedResponse) {
                log.debug('Cache hit', { key: cacheKey });
                res.set('X-Cache', 'HIT');
                return res.json(cachedResponse);
            }

            // Cache miss - proceed with request
            log.debug('Cache miss', { key: cacheKey });
            res.set('X-Cache', 'MISS');

            // Intercept response to cache it
            const originalSend = res.json;
            res.json = function(data) {
                // Only cache successful responses
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    cacheService.set(cacheKey, data, ttl).catch(error => {
                        log.error('Failed to cache response:', error);
                    });
                }
                return originalSend.call(this, data);
            };

            next();
        } catch (error) {
            log.error('Cache middleware error:', error);
            next();
        }
    };
};

// User-specific cache middleware
export const userCache = (ttl = 3600) => {
    return cache({
        ttl,
        keyGenerator: (req) => {
            const userId = req.user?.id || 'anonymous';
            const keyData = {
                path: req.path,
                query: req.query,
                userId
            };
            return `user:${userId}:${crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex')}`;
        },
        condition: (req) => !!req.user // Only cache for authenticated users
    });
};

// Receipt-specific cache middleware
export const receiptCache = (ttl = 1800) => {
    return cache({
        ttl,
        keyGenerator: (req) => {
            const userId = req.user?.id;
            const receiptId = req.params.id;
            if (receiptId) {
                return `receipt:${receiptId}`;
            }
            return `user:${userId}:receipts:${crypto.createHash('md5').update(JSON.stringify(req.query)).digest('hex')}`;
        }
    });
};

// Cache invalidation middleware
export const invalidateCache = (patterns = []) => {
    return async (req, res, next) => {
        const originalSend = res.json;
        res.json = async function(data) {
            // Only invalidate on successful operations
            if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                    for (const pattern of patterns) {
                        let actualPattern = pattern;

                        // Replace placeholders with actual values
                        if (pattern.includes(':userId') && req.user?.id) {
                            actualPattern = actualPattern.replace(':userId', req.user.id);
                        }
                        if (pattern.includes(':receiptId') && req.params.id) {
                            actualPattern = actualPattern.replace(':receiptId', req.params.id);
                        }

                        await cacheService.delPattern(actualPattern);
                        log.debug('Cache invalidated', { pattern: actualPattern });
                    }
                } catch (error) {
                    log.error('Cache invalidation error:', error);
                }
            }
            return originalSend.call(this, data);
        };

        next();
    };
};

// Conditional cache middleware based on query parameters
export const conditionalCache = (conditions) => {
    return cache({
        condition: (req) => {
            return Object.entries(conditions).every(([param, value]) => {
                if (Array.isArray(value)) {
                    return value.includes(req.query[param]);
                }
                return req.query[param] === value;
            });
        }
    });
};

// Cache warming middleware (pre-populate cache)
export const warmCache = (cacheFunction) => {
    return async (req, res, next) => {
        try {
            // Run cache warming in background
            setImmediate(async () => {
                try {
                    await cacheFunction(req);
                } catch (error) {
                    log.error('Cache warming error:', error);
                }
            });
        } catch (error) {
            log.error('Cache warming middleware error:', error);
        }
        next();
    };
};

// Cache statistics middleware
export const cacheStats = () => {
    let hits = 0;
    let misses = 0;

    return (req, res, next) => {
        const originalSetHeader = res.set;
        res.set = function(field, value) {
            if (field === 'X-Cache') {
                if (value === 'HIT') hits++;
                else if (value === 'MISS') misses++;
            }
            return originalSetHeader.call(this, field, value);
        };

        // Expose stats on response object
        res.cacheStats = () => ({
            hits,
            misses,
            hitRate: hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0
        });

        next();
    };
};

// Cache with compression for large responses
export const compressedCache = (options = {}) => {
    const { ttl = 3600, compressionThreshold = 1024 } = options;

    return async (req, res, next) => {
        if (req.method !== 'GET') {
            return next();
        }

        try {
            const cacheKey = `compressed:${crypto.createHash('md5').update(`${req.path}${JSON.stringify(req.query)}`).digest('hex')}`;

            const cachedResponse = await cacheService.get(cacheKey);
            if (cachedResponse) {
                res.set('X-Cache', 'HIT');
                res.set('Content-Encoding', 'gzip');
                return res.send(Buffer.from(cachedResponse, 'base64'));
            }

            res.set('X-Cache', 'MISS');

            const originalSend = res.send;
            res.send = function(data) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
                    if (dataString.length > compressionThreshold) {
                        // Store compressed data
                        const compressed = Buffer.from(dataString).toString('base64');
                        cacheService.set(cacheKey, compressed, ttl);
                    }
                }
                return originalSend.call(this, data);
            };

            next();
        } catch (error) {
            log.error('Compressed cache middleware error:', error);
            next();
        }
    };
};

// Export commonly used cache configurations
export const cacheConfigs = {
    short: { ttl: 300 }, // 5 minutes
    medium: { ttl: 1800 }, // 30 minutes
    long: { ttl: 3600 }, // 1 hour
    veryLong: { ttl: 86400 }, // 24 hours
};

export default {
    cache,
    userCache,
    receiptCache,
    invalidateCache,
    conditionalCache,
    warmCache,
    cacheStats,
    compressedCache,
    cacheConfigs
};