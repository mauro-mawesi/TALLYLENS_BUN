import ocrWorker from './ocrWorker.js';
import categorizationWorker from './categorizationWorker.js';
import cleanupWorker from './cleanupWorker.js';
import budgetWorker from './budgetWorker.js';
import queueService from '../services/queueService.js';
import { log } from '../utils/logger.js';
import config from '../config/environment.js';

class WorkerManager {
    constructor() {
        this.workers = {
            ocr: ocrWorker,
            categorization: categorizationWorker,
            cleanup: cleanupWorker,
            budget: budgetWorker
        };
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) {
            log.warn('Worker manager is already running');
            return;
        }

        if (!config.redis.url) {
            log.warn('Redis not configured, workers will not start');
            return;
        }

        try {
            log.info('Starting worker manager...');

            // Wait for queue service to be ready
            if (!queueService.isConnected) {
                log.info('Waiting for queue service to connect...');
                await this.waitForQueueService();
            }

            // Setup recurring jobs
            await queueService.scheduleRecurringJobs();

            // Start all workers
            for (const [name, worker] of Object.entries(this.workers)) {
                try {
                    worker.start();
                    log.info(`${name} worker started successfully`);
                } catch (error) {
                    log.error(`Failed to start ${name} worker:`, error);
                }
            }

            this.isRunning = true;

            // Setup graceful shutdown
            this.setupGracefulShutdown();

            log.info('Worker manager started successfully');

        } catch (error) {
            log.error('Failed to start worker manager:', error);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        try {
            log.info('Stopping worker manager...');

            // Stop all workers
            for (const [name, worker] of Object.entries(this.workers)) {
                try {
                    worker.stop();
                    log.info(`${name} worker stopped`);
                } catch (error) {
                    log.error(`Failed to stop ${name} worker:`, error);
                }
            }

            // Close queue connections
            await queueService.cleanup();

            this.isRunning = false;
            log.info('Worker manager stopped successfully');

        } catch (error) {
            log.error('Failed to stop worker manager:', error);
            throw error;
        }
    }

    async waitForQueueService(timeout = 30000) {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkConnection = () => {
                if (queueService.isConnected) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Queue service connection timeout'));
                } else {
                    setTimeout(checkConnection, 1000);
                }
            };

            checkConnection();
        });
    }

    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            log.info(`Received ${signal}, shutting down gracefully...`);

            try {
                await this.stop();
                process.exit(0);
            } catch (error) {
                log.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart
    }

    // Health check for all workers
    getHealthStatus() {
        const status = {
            isRunning: this.isRunning,
            queueService: {
                isConnected: queueService.isConnected
            },
            workers: {}
        };

        for (const [name, worker] of Object.entries(this.workers)) {
            status.workers[name] = worker.getHealthStatus();
        }

        return status;
    }

    // Get statistics for all queues
    async getQueueStatistics() {
        if (!queueService.isConnected) {
            return { error: 'Queue service not connected' };
        }

        try {
            return await queueService.getAllQueueStats();
        } catch (error) {
            log.error('Failed to get queue statistics:', error);
            return { error: error.message };
        }
    }

    // Manual job management
    async addJob(queueName, jobType, data, options = {}) {
        switch (queueName) {
            case 'ocr':
                return await queueService.addOCRJob(data.receiptId, data.imageUrl, options.priority);
            case 'categorization':
                return await queueService.addCategorizationJob(data.receiptId, data.extractedText, options.priority);
            case 'cleanup':
                return await queueService.addCleanupJob(data.type, data.options);
            case 'budget':
                return await queueService.queues.budget.add(jobType, data, options);
            default:
                throw new Error(`Unknown queue: ${queueName}`);
        }
    }

    // Pause/Resume workers
    async pauseWorker(workerName) {
        if (!this.workers[workerName]) {
            throw new Error(`Worker ${workerName} not found`);
        }

        const queueName = workerName;
        await queueService.pauseQueue(queueName);
        log.info(`Worker ${workerName} paused`);
    }

    async resumeWorker(workerName) {
        if (!this.workers[workerName]) {
            throw new Error(`Worker ${workerName} not found`);
        }

        const queueName = workerName;
        await queueService.resumeQueue(queueName);
        log.info(`Worker ${workerName} resumed`);
    }

    // Process specific job by ID
    async retryJob(queueName, jobId) {
        return await queueService.retryJob(queueName, jobId);
    }

    async removeJob(queueName, jobId) {
        return await queueService.removeJob(queueName, jobId);
    }

    // Get job details
    async getJob(queueName, jobId) {
        return await queueService.getJob(queueName, jobId);
    }

    async getJobs(queueName, types, start, end) {
        return await queueService.getJobs(queueName, types, start, end);
    }
}

// Create singleton instance
const workerManager = new WorkerManager();

// Auto-start in production
if (config.isProduction || process.env.START_WORKERS === 'true') {
    workerManager.start().catch(error => {
        log.error('Failed to auto-start workers:', error);
        process.exit(1);
    });
}

export default workerManager;