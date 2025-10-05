import Bull from 'bull';
import config from '../config/environment.js';
import { log } from '../utils/logger.js';

class QueueService {
    constructor() {
        this.queues = {};
        this.isConnected = false;

        if (config.redis.host && config.redis.port) {
            this.connect();
        } else {
            log.warn('Redis not configured, background jobs will be disabled');
        }
    }

    connect() {
        try {
            // Build Redis connection config from individual properties
            const redisConfig = {
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password,
            };

            // Add username if provided (Redis 6+)
            if (config.redis.username) {
                redisConfig.username = config.redis.username;
            }

            // Add TLS if enabled
            if (config.redis.tls) {
                redisConfig.tls = {
                    rejectUnauthorized: false
                };
            }

            // Base queue options helper
            const getQueueOptions = (jobOptions, settings = {}) => {
                const options = {
                    redis: redisConfig,
                    defaultJobOptions: jobOptions
                };

                if (settings && Object.keys(settings).length > 0) {
                    options.settings = settings;
                }

                return options;
            };

            // OCR Processing Queue
            this.queues.ocr = new Bull('OCR Processing', getQueueOptions({
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
                removeOnComplete: 10,
                removeOnFail: 5,
            }, {
                stalledInterval: 30 * 1000,
                maxStalledCount: 1,
            }));

            // Categorization Queue
            this.queues.categorization = new Bull('Categorization', getQueueOptions({
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
                removeOnComplete: 10,
                removeOnFail: 5,
            }));

            // Email Queue
            this.queues.email = new Bull('Email', getQueueOptions({
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: 20,
                removeOnFail: 10,
            }));

            // File Processing Queue
            this.queues.fileProcessing = new Bull('File Processing', getQueueOptions({
                attempts: 2,
                backoff: {
                    type: 'fixed',
                    delay: 3000,
                },
                removeOnComplete: 5,
                removeOnFail: 5,
            }));

            // Cleanup Queue
            this.queues.cleanup = new Bull('Cleanup', getQueueOptions({
                attempts: 1,
                removeOnComplete: 3,
                removeOnFail: 3,
            }));

            // Statistics Queue
            this.queues.statistics = new Bull('Statistics', getQueueOptions({
                attempts: 2,
                backoff: {
                    type: 'fixed',
                    delay: 10000,
                },
                removeOnComplete: 5,
                removeOnFail: 3,
            }));

            // Budget Queue
            this.queues.budget = new Bull('Budget', getQueueOptions({
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: 10,
                removeOnFail: 5,
            }));

            this.setupEventListeners();
            this.isConnected = true;

            log.info('Queue service connected successfully');
        } catch (error) {
            log.error('Failed to connect to queue service:', error);
        }
    }

    setupEventListeners() {
        Object.entries(this.queues).forEach(([queueName, queue]) => {
            queue.on('error', (error) => {
                log.error(`Queue ${queueName} error:`, error);
            });

            queue.on('waiting', (jobId) => {
                log.debug(`Job ${jobId} waiting in queue ${queueName}`);
            });

            queue.on('active', (job) => {
                log.info(`Job ${job.id} started in queue ${queueName}`, {
                    jobId: job.id,
                    queue: queueName,
                    data: job.data
                });
            });

            queue.on('completed', (job, result) => {
                log.info(`Job ${job.id} completed in queue ${queueName}`, {
                    jobId: job.id,
                    queue: queueName,
                    result: result
                });
            });

            queue.on('failed', (job, error) => {
                log.error(`Job ${job.id} failed in queue ${queueName}:`, {
                    jobId: job.id,
                    queue: queueName,
                    error: error.message,
                    attempts: job.attemptsMade
                });
            });

            queue.on('stalled', (job) => {
                log.warn(`Job ${job.id} stalled in queue ${queueName}`);
            });
        });
    }

    // OCR Jobs
    async addOCRJob(receiptId, imageUrl, priority = 'normal') {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        const priorityMap = { low: 10, normal: 0, high: -10, critical: -20 };

        return await this.queues.ocr.add('process-ocr', {
            receiptId,
            imageUrl,
            timestamp: new Date().toISOString()
        }, {
            priority: priorityMap[priority] || 0,
            delay: priority === 'low' ? 30000 : 0 // 30 second delay for low priority
        });
    }

    // Categorization Jobs
    async addCategorizationJob(receiptId, extractedText, priority = 'normal') {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        const priorityMap = { low: 10, normal: 0, high: -10 };

        return await this.queues.categorization.add('categorize-receipt', {
            receiptId,
            extractedText,
            timestamp: new Date().toISOString()
        }, {
            priority: priorityMap[priority] || 0
        });
    }

    // Email Jobs
    async addEmailJob(type, recipient, data, priority = 'normal') {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        const priorityMap = { low: 10, normal: 0, high: -10, critical: -20 };

        return await this.queues.email.add('send-email', {
            type,
            recipient,
            data,
            timestamp: new Date().toISOString()
        }, {
            priority: priorityMap[priority] || 0,
            delay: priority === 'low' ? 60000 : 0 // 1 minute delay for low priority
        });
    }

    // File Processing Jobs
    async addFileProcessingJob(fileId, operation, options = {}) {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        return await this.queues.fileProcessing.add('process-file', {
            fileId,
            operation, // 'thumbnail', 'compress', 'convert', etc.
            options,
            timestamp: new Date().toISOString()
        });
    }

    // Cleanup Jobs
    async addCleanupJob(type, options = {}) {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        return await this.queues.cleanup.add('cleanup', {
            type, // 'expired-tokens', 'old-files', 'temp-files', etc.
            options,
            timestamp: new Date().toISOString()
        });
    }

    // Statistics Jobs
    async addStatisticsJob(type, userId = null, options = {}) {
        if (!this.isConnected) {
            throw new Error('Queue service not connected');
        }

        return await this.queues.statistics.add('calculate-statistics', {
            type, // 'user-stats', 'global-stats', 'category-stats', etc.
            userId,
            options,
            timestamp: new Date().toISOString()
        });
    }

    // Scheduled Jobs
    async scheduleRecurringJobs() {
        if (!this.isConnected) {
            return;
        }

        try {
            // Daily cleanup job
            await this.queues.cleanup.add('daily-cleanup', {
                type: 'daily',
                timestamp: new Date().toISOString()
            }, {
                repeat: { cron: '0 2 * * *' }, // Every day at 2 AM
                removeOnComplete: 1,
                removeOnFail: 1
            });

            // Weekly statistics calculation
            await this.queues.statistics.add('weekly-stats', {
                type: 'weekly',
                timestamp: new Date().toISOString()
            }, {
                repeat: { cron: '0 3 * * 0' }, // Every Sunday at 3 AM
                removeOnComplete: 1,
                removeOnFail: 1
            });

            // Token cleanup job
            await this.queues.cleanup.add('token-cleanup', {
                type: 'expired-tokens',
                timestamp: new Date().toISOString()
            }, {
                repeat: { cron: '0 1 * * *' }, // Every day at 1 AM
                removeOnComplete: 1,
                removeOnFail: 1
            });

            log.info('Scheduled recurring jobs set up successfully');
        } catch (error) {
            log.error('Failed to schedule recurring jobs:', error);
        }
    }

    // Job Management
    async getJob(queueName, jobId) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        return await this.queues[queueName].getJob(jobId);
    }

    async getJobs(queueName, types = ['waiting', 'active', 'completed', 'failed'], start = 0, end = 100) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        return await this.queues[queueName].getJobs(types, start, end);
    }

    async removeJob(queueName, jobId) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        const job = await this.queues[queueName].getJob(jobId);
        if (job) {
            await job.remove();
            return true;
        }
        return false;
    }

    async retryJob(queueName, jobId) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        const job = await this.queues[queueName].getJob(jobId);
        if (job) {
            await job.retry();
            return true;
        }
        return false;
    }

    // Queue Statistics
    async getQueueStats(queueName) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        const queue = this.queues[queueName];
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaiting(),
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed(),
            queue.getDelayed()
        ]);

        return {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length,
            total: waiting.length + active.length + completed.length + failed.length + delayed.length
        };
    }

    async getAllQueueStats() {
        const stats = {};
        for (const queueName of Object.keys(this.queues)) {
            stats[queueName] = await this.getQueueStats(queueName);
        }
        return stats;
    }

    // Queue Health Check
    async healthCheck() {
        if (!this.isConnected) {
            return {
                status: 'DOWN',
                message: 'Queue service not connected'
            };
        }

        try {
            const stats = await this.getAllQueueStats();
            const hasFailedJobs = Object.values(stats).some(stat => stat.failed > 10);

            return {
                status: hasFailedJobs ? 'WARNING' : 'UP',
                message: hasFailedJobs ? 'Some queues have failed jobs' : 'All queues healthy',
                stats
            };
        } catch (error) {
            return {
                status: 'DOWN',
                message: error.message
            };
        }
    }

    // Pause/Resume Queues
    async pauseQueue(queueName) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        await this.queues[queueName].pause();
        log.info(`Queue ${queueName} paused`);
    }

    async resumeQueue(queueName) {
        if (!this.queues[queueName]) {
            throw new Error(`Queue ${queueName} not found`);
        }

        await this.queues[queueName].resume();
        log.info(`Queue ${queueName} resumed`);
    }

    // Cleanup
    async cleanup() {
        if (!this.isConnected) {
            return;
        }

        try {
            for (const [queueName, queue] of Object.entries(this.queues)) {
                await queue.close();
                log.info(`Queue ${queueName} closed`);
            }
            this.isConnected = false;
            log.info('Queue service disconnected');
        } catch (error) {
            log.error('Error during queue cleanup:', error);
        }
    }
}

// Create singleton instance
const queueService = new QueueService();

export default queueService;