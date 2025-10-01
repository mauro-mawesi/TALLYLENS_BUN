import queueService from '../services/queueService.js';
import RefreshToken from '../models/RefreshToken.js';
import { log } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Op } from 'sequelize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CleanupWorker {
    constructor() {
        this.isRunning = false;
    }

    start() {
        if (!queueService.isConnected) {
            log.warn('Queue service not connected, cleanup worker not started');
            return;
        }

        if (this.isRunning) {
            log.warn('Cleanup worker is already running');
            return;
        }

        this.isRunning = true;

        // Process cleanup jobs
        queueService.queues.cleanup.process('cleanup', this.concurrency, async (job) => {
            return await this.processCleanup(job);
        });

        // Process daily cleanup jobs
        queueService.queues.cleanup.process('daily-cleanup', 1, async (job) => {
            return await this.processDailyCleanup(job);
        });

        // Process token cleanup jobs
        queueService.queues.cleanup.process('token-cleanup', 1, async (job) => {
            return await this.processTokenCleanup(job);
        });

        log.info('Cleanup worker started');
    }

    stop() {
        this.isRunning = false;
        log.info('Cleanup worker stopped');
    }

    get concurrency() {
        return process.env.CLEANUP_CONCURRENCY || 1;
    }

    async processCleanup(job) {
        const { type, options } = job.data;
        const startTime = Date.now();

        try {
            log.info('Starting cleanup process', { type, options });

            let result;
            switch (type) {
                case 'expired-tokens':
                    result = await this.cleanupExpiredTokens();
                    break;
                case 'old-files':
                    result = await this.cleanupOldFiles(options);
                    break;
                case 'temp-files':
                    result = await this.cleanupTempFiles(options);
                    break;
                case 'old-logs':
                    result = await this.cleanupOldLogs(options);
                    break;
                case 'cache':
                    result = await this.cleanupCache(options);
                    break;
                default:
                    throw new Error(`Unknown cleanup type: ${type}`);
            }

            const processingTime = Date.now() - startTime;
            log.info('Cleanup process completed', {
                type,
                result,
                processingTime
            });

            return {
                type,
                result,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('Cleanup process failed', {
                type,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async processDailyCleanup(job) {
        const startTime = Date.now();

        try {
            log.info('Starting daily cleanup process');

            const results = {};

            // Cleanup expired tokens
            results.expiredTokens = await this.cleanupExpiredTokens();

            // Cleanup old temporary files
            results.tempFiles = await this.cleanupTempFiles({ olderThanDays: 1 });

            // Cleanup old log files
            results.logFiles = await this.cleanupOldLogs({ olderThanDays: 30 });

            // Cleanup old upload files without receipts
            results.orphanedFiles = await this.cleanupOrphanedFiles();

            const processingTime = Date.now() - startTime;
            log.info('Daily cleanup completed', {
                results,
                processingTime
            });

            return {
                type: 'daily',
                results,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('Daily cleanup failed', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async processTokenCleanup(job) {
        const startTime = Date.now();

        try {
            log.info('Starting token cleanup process');

            const result = await this.cleanupExpiredTokens();

            const processingTime = Date.now() - startTime;
            log.info('Token cleanup completed', {
                result,
                processingTime
            });

            return {
                type: 'token-cleanup',
                result,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('Token cleanup failed', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async cleanupExpiredTokens() {
        try {
            const deletedCount = await RefreshToken.destroy({
                where: {
                    [Op.or]: [
                        {
                            expiresAt: {
                                [Op.lt]: new Date()
                            }
                        },
                        {
                            revoked: true,
                            revokedAt: {
                                [Op.lt]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
                            }
                        }
                    ]
                }
            });

            log.info(`Cleaned up ${deletedCount} expired/revoked tokens`);
            return { deletedTokens: deletedCount };

        } catch (error) {
            log.error('Failed to cleanup expired tokens:', error);
            throw error;
        }
    }

    async cleanupOldFiles(options = {}) {
        const { directory = 'uploads', olderThanDays = 30 } = options;
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

        try {
            const uploadsDir = path.join(__dirname, '../../', directory);
            const files = await fs.readdir(uploadsDir);

            let deletedCount = 0;
            let deletedSize = 0;

            for (const file of files) {
                const filePath = path.join(uploadsDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isFile() && stats.mtime < cutoffDate) {
                        deletedSize += stats.size;
                        await fs.unlink(filePath);
                        deletedCount++;
                        log.debug(`Deleted old file: ${file}`);
                    }
                } catch (fileError) {
                    log.warn(`Error processing file ${file}:`, fileError.message);
                }
            }

            log.info(`Cleaned up ${deletedCount} old files (${Math.round(deletedSize / 1024 / 1024)}MB)`);
            return { deletedFiles: deletedCount, deletedSize };

        } catch (error) {
            log.error('Failed to cleanup old files:', error);
            throw error;
        }
    }

    async cleanupTempFiles(options = {}) {
        const { olderThanDays = 1 } = options;
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

        try {
            const tempDir = path.join(__dirname, '../../tmp');
            let deletedCount = 0;

            try {
                const files = await fs.readdir(tempDir);

                for (const file of files) {
                    const filePath = path.join(tempDir, file);
                    try {
                        const stats = await fs.stat(filePath);
                        if (stats.mtime < cutoffDate) {
                            await fs.unlink(filePath);
                            deletedCount++;
                        }
                    } catch (fileError) {
                        log.warn(`Error processing temp file ${file}:`, fileError.message);
                    }
                }
            } catch (dirError) {
                if (dirError.code !== 'ENOENT') {
                    throw dirError;
                }
                // Directory doesn't exist, that's fine
            }

            log.info(`Cleaned up ${deletedCount} temporary files`);
            return { deletedTempFiles: deletedCount };

        } catch (error) {
            log.error('Failed to cleanup temp files:', error);
            throw error;
        }
    }

    async cleanupOldLogs(options = {}) {
        const { olderThanDays = 30 } = options;
        const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

        try {
            const logsDir = path.join(__dirname, '../../logs');
            let deletedCount = 0;

            try {
                const files = await fs.readdir(logsDir);

                for (const file of files) {
                    if (file.endsWith('.log')) {
                        const filePath = path.join(logsDir, file);
                        try {
                            const stats = await fs.stat(filePath);
                            if (stats.mtime < cutoffDate) {
                                await fs.unlink(filePath);
                                deletedCount++;
                                log.debug(`Deleted old log file: ${file}`);
                            }
                        } catch (fileError) {
                            log.warn(`Error processing log file ${file}:`, fileError.message);
                        }
                    }
                }
            } catch (dirError) {
                if (dirError.code !== 'ENOENT') {
                    throw dirError;
                }
            }

            log.info(`Cleaned up ${deletedCount} old log files`);
            return { deletedLogFiles: deletedCount };

        } catch (error) {
            log.error('Failed to cleanup old logs:', error);
            throw error;
        }
    }

    async cleanupOrphanedFiles() {
        try {
            // This would require importing Receipt model and checking
            // which files in uploads directory don't have corresponding receipts
            // Implementation depends on your file storage strategy

            log.info('Orphaned files cleanup completed (not implemented)');
            return { deletedOrphanedFiles: 0 };

        } catch (error) {
            log.error('Failed to cleanup orphaned files:', error);
            throw error;
        }
    }

    async cleanupCache(options = {}) {
        try {
            const cacheService = (await import('../services/cacheService.js')).default;

            if (!cacheService.isConnected) {
                return { message: 'Cache not connected' };
            }

            const { pattern = '*' } = options;

            if (pattern === '*') {
                await cacheService.flushAll();
                log.info('Cache completely flushed');
                return { message: 'All cache cleared' };
            } else {
                await cacheService.delPattern(pattern);
                log.info(`Cache pattern ${pattern} cleared`);
                return { message: `Pattern ${pattern} cleared` };
            }

        } catch (error) {
            log.error('Failed to cleanup cache:', error);
            throw error;
        }
    }

    getHealthStatus() {
        return {
            isRunning: this.isRunning,
            concurrency: this.concurrency,
            queueStatus: queueService.isConnected ? 'connected' : 'disconnected'
        };
    }
}

const cleanupWorker = new CleanupWorker();
export default cleanupWorker;