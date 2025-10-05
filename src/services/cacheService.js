import Redis from 'ioredis';
import config from '../config/environment.js';
import { log } from '../utils/logger.js';

class CacheService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.defaultTTL = config.redis.cacheTtl || 3600; // 1 hour default

        if (config.redis.host && config.redis.port) {
            this.connect();
        } else {
            log.warn('Redis not configured, caching will be disabled');
        }
    }

    connect() {
        try {
            // Build Redis connection options
            const options = {
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password,
                retryDelayOnFailover: 100,
                enableReadyCheck: false,
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                reconnectOnError: (err) => {
                    const targetError = 'READONLY';
                    return err.message.includes(targetError);
                }
            };

            // Add username if provided (Redis 6+)
            if (config.redis.username) {
                options.username = config.redis.username;
            }

            // Add TLS if enabled
            if (config.redis.tls) {
                options.tls = {
                    rejectUnauthorized: false // Accept self-signed certificates
                };
            }

            this.client = new Redis(options);

            this.client.on('connect', () => {
                log.info('Redis client connected');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                log.info('Redis client ready');
            });

            this.client.on('error', (err) => {
                log.error('Redis client error:', err);
                this.isConnected = false;
            });

            this.client.on('close', () => {
                log.warn('Redis client connection closed');
                this.isConnected = false;
            });

            this.client.on('reconnecting', () => {
                log.info('Redis client reconnecting');
            });

        } catch (error) {
            log.error('Failed to initialize Redis client:', error);
        }
    }

    async get(key) {
        if (!this.isConnected || !this.client) {
            return null;
        }

        try {
            const result = await this.client.get(key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (error) {
            log.error('Cache get error:', error);
            return null;
        }
    }

    async set(key, value, ttl = this.defaultTTL) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            const serialized = JSON.stringify(value);
            if (ttl) {
                await this.client.setex(key, ttl, serialized);
            } else {
                await this.client.set(key, serialized);
            }
            return true;
        } catch (error) {
            log.error('Cache set error:', error);
            return false;
        }
    }

    async del(key) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            log.error('Cache delete error:', error);
            return false;
        }
    }

    async delPattern(pattern) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
            return true;
        } catch (error) {
            log.error('Cache delete pattern error:', error);
            return false;
        }
    }

    async exists(key) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            log.error('Cache exists error:', error);
            return false;
        }
    }

    async expire(key, ttl) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            await this.client.expire(key, ttl);
            return true;
        } catch (error) {
            log.error('Cache expire error:', error);
            return false;
        }
    }

    async ttl(key) {
        if (!this.isConnected || !this.client) {
            return -1;
        }

        try {
            return await this.client.ttl(key);
        } catch (error) {
            log.error('Cache TTL error:', error);
            return -1;
        }
    }

    async flushAll() {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            await this.client.flushall();
            return true;
        } catch (error) {
            log.error('Cache flush error:', error);
            return false;
        }
    }

    // Specialized caching methods
    async cacheUserData(userId, userData, ttl = 3600) {
        const key = `user:${userId}`;
        return await this.set(key, userData, ttl);
    }

    async getUserData(userId) {
        const key = `user:${userId}`;
        return await this.get(key);
    }

    async invalidateUserData(userId) {
        const key = `user:${userId}`;
        return await this.del(key);
    }

    async cacheReceiptData(receiptId, receiptData, ttl = 1800) {
        const key = `receipt:${receiptId}`;
        return await this.set(key, receiptData, ttl);
    }

    async getReceiptData(receiptId) {
        const key = `receipt:${receiptId}`;
        return await this.get(key);
    }

    async invalidateReceiptData(receiptId) {
        const key = `receipt:${receiptId}`;
        return await this.del(key);
    }

    async cacheUserReceipts(userId, receipts, ttl = 900) {
        const key = `user:${userId}:receipts`;
        return await this.set(key, receipts, ttl);
    }

    async getUserReceipts(userId) {
        const key = `user:${userId}:receipts`;
        return await this.get(key);
    }

    async invalidateUserReceipts(userId) {
        const key = `user:${userId}:receipts`;
        return await this.del(key);
    }

    // Session caching
    async cacheSession(sessionId, sessionData, ttl = 86400) {
        const key = `session:${sessionId}`;
        return await this.set(key, sessionData, ttl);
    }

    async getSession(sessionId) {
        const key = `session:${sessionId}`;
        return await this.get(key);
    }

    async invalidateSession(sessionId) {
        const key = `session:${sessionId}`;
        return await this.del(key);
    }

    // Rate limiting cache
    async incrementRateLimit(identifier, windowMs) {
        if (!this.isConnected || !this.client) {
            return { count: 0, ttl: windowMs };
        }

        try {
            const key = `rate_limit:${identifier}`;
            const multi = this.client.multi();
            multi.incr(key);
            multi.expire(key, Math.ceil(windowMs / 1000));
            multi.ttl(key);

            const results = await multi.exec();
            const count = results[0][1];
            const ttl = results[2][1];

            return { count, ttl: ttl * 1000 }; // Convert back to milliseconds
        } catch (error) {
            log.error('Rate limit cache error:', error);
            return { count: 0, ttl: windowMs };
        }
    }

    // OCR result caching
    async cacheOCRResult(imageHash, ocrResult, ttl = 7200) {
        const key = `ocr:${imageHash}`;
        return await this.set(key, ocrResult, ttl);
    }

    async getOCRResult(imageHash) {
        const key = `ocr:${imageHash}`;
        return await this.get(key);
    }

    // Category cache
    async cacheCategoryResult(textHash, category, ttl = 7200) {
        const key = `category:${textHash}`;
        return await this.set(key, category, ttl);
    }

    async getCategoryResult(textHash) {
        const key = `category:${textHash}`;
        return await this.get(key);
    }

    // Statistics caching
    async cacheUserStats(userId, stats, ttl = 1800) {
        const key = `stats:user:${userId}`;
        return await this.set(key, stats, ttl);
    }

    async getUserStats(userId) {
        const key = `stats:user:${userId}`;
        return await this.get(key);
    }

    async invalidateUserStats(userId) {
        const key = `stats:user:${userId}`;
        return await this.del(key);
    }

    // Global stats caching
    async cacheGlobalStats(stats, ttl = 3600) {
        const key = 'stats:global';
        return await this.set(key, stats, ttl);
    }

    async getGlobalStats() {
        const key = 'stats:global';
        return await this.get(key);
    }

    // Health check
    async healthCheck() {
        if (!this.isConnected || !this.client) {
            return {
                status: 'DOWN',
                message: 'Redis client not connected'
            };
        }

        try {
            const start = Date.now();
            await this.client.ping();
            const responseTime = Date.now() - start;

            return {
                status: 'UP',
                responseTime: `${responseTime}ms`,
                message: 'Redis connection healthy'
            };
        } catch (error) {
            return {
                status: 'DOWN',
                message: error.message
            };
        }
    }

    // Cleanup and shutdown
    async disconnect() {
        if (this.client) {
            try {
                await this.client.quit();
                log.info('Redis client disconnected');
            } catch (error) {
                log.error('Error disconnecting Redis client:', error);
            }
        }
    }
}

// Create singleton instance
const cacheService = new CacheService();

export default cacheService;