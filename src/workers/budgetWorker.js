import queueService from '../services/queueService.js';
import * as budgetService from '../services/budgetService.js';
import notificationService from '../services/notificationService.js';
import NotificationPreference from '../models/NotificationPreference.js';
import { log } from '../utils/logger.js';
import cron from 'node-cron';

class BudgetWorker {
    constructor() {
        this.isRunning = false;
        this.cronJobs = [];
    }

    start() {
        if (!queueService.isConnected) {
            log.warn('Queue service not connected, budget worker not started');
            return;
        }

        if (this.isRunning) {
            log.warn('Budget worker is already running');
            return;
        }

        this.isRunning = true;

        // Process budget alert jobs
        queueService.queues.budget.process('check-alerts', this.concurrency, async (job) => {
            return await this.processAlerts(job);
        });

        // Process budget renewal jobs
        queueService.queues.budget.process('renew-recurring', this.concurrency, async (job) => {
            return await this.processRecurringBudgets(job);
        });

        // Process digest jobs
        queueService.queues.budget.process('send-digest', this.concurrency, async (job) => {
            return await this.sendDigest(job);
        });

        // Setup cron jobs
        this.setupCronJobs();

        log.info('Budget worker started');
    }

    stop() {
        this.isRunning = false;

        // Stop all cron jobs
        this.cronJobs.forEach(job => job.stop());
        this.cronJobs = [];

        log.info('Budget worker stopped');
    }

    get concurrency() {
        return parseInt(process.env.BUDGET_WORKER_CONCURRENCY) || 2;
    }

    setupCronJobs() {
        // Process active budgets every 6 hours
        const budgetCheckJob = cron.schedule('0 */6 * * *', async () => {
            try {
                log.info('Running scheduled budget check...');
                await queueService.queues.budget.add('check-alerts', {
                    type: 'scheduled',
                    timestamp: new Date()
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 60000 }
                });
            } catch (error) {
                log.error('Error scheduling budget check:', error);
            }
        });

        // Process expired recurring budgets daily at 2 AM
        const renewalJob = cron.schedule('0 2 * * *', async () => {
            try {
                log.info('Running scheduled budget renewal...');
                await queueService.queues.budget.add('renew-recurring', {
                    type: 'daily',
                    timestamp: new Date()
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 300000 }
                });
            } catch (error) {
                log.error('Error scheduling budget renewal:', error);
            }
        });

        // Weekly digest every Sunday at 6 PM
        const weeklyDigestJob = cron.schedule('0 18 * * 0', async () => {
            try {
                log.info('Running weekly digest...');
                await this.scheduleDigests('weekly', 0); // 0 = Sunday
            } catch (error) {
                log.error('Error scheduling weekly digest:', error);
            }
        });

        // Monthly digest on first day of month at 6 PM
        const monthlyDigestJob = cron.schedule('0 18 1 * *', async () => {
            try {
                log.info('Running monthly digest...');
                await this.scheduleDigests('monthly');
            } catch (error) {
                log.error('Error scheduling monthly digest:', error);
            }
        });

        this.cronJobs.push(budgetCheckJob, renewalJob, weeklyDigestJob, monthlyDigestJob);

        log.info('Budget worker cron jobs scheduled');
    }

    async processAlerts(job) {
        const { type, timestamp } = job.data;
        const startTime = Date.now();

        try {
            log.info('Processing budget alerts', { type, timestamp });

            // Process all active budgets
            const results = await budgetService.processActiveBudgets();

            // Send notifications for new alerts
            if (results.alertsCreated > 0) {
                log.info(`${results.alertsCreated} budget alerts created, sending notifications...`);
            }

            const duration = Date.now() - startTime;
            log.info('Budget alerts processed', {
                ...results,
                duration: `${duration}ms`
            });

            return results;
        } catch (error) {
            log.error('Error processing budget alerts:', error);
            throw error;
        }
    }

    async processRecurringBudgets(job) {
        const { type, timestamp } = job.data;
        const startTime = Date.now();

        try {
            log.info('Processing recurring budgets', { type, timestamp });

            // Process expired recurring budgets
            const results = await budgetService.processExpiredRecurringBudgets();

            const duration = Date.now() - startTime;
            log.info('Recurring budgets processed', {
                ...results,
                duration: `${duration}ms`
            });

            return results;
        } catch (error) {
            log.error('Error processing recurring budgets:', error);
            throw error;
        }
    }

    async sendDigest(job) {
        const { userId, frequency } = job.data;
        const startTime = Date.now();

        try {
            log.info('Sending budget digest', { userId, frequency });

            let result;
            if (frequency === 'weekly') {
                result = await notificationService.sendWeeklyDigest(userId);
            } else if (frequency === 'monthly') {
                result = await notificationService.sendMonthlyDigest(userId);
            } else {
                throw new Error(`Unknown digest frequency: ${frequency}`);
            }

            const duration = Date.now() - startTime;
            log.info('Digest sent', {
                userId,
                frequency,
                sent: result.sent,
                duration: `${duration}ms`
            });

            return result;
        } catch (error) {
            log.error('Error sending digest:', error);
            throw error;
        }
    }

    async scheduleDigests(frequency, day = null) {
        try {
            const users = await NotificationPreference.findUsersForDigest(frequency, day);

            log.info(`Scheduling ${frequency} digest for ${users.length} users`);

            for (const pref of users) {
                await queueService.queues.budget.add('send-digest', {
                    userId: pref.userId,
                    frequency,
                    day,
                    timestamp: new Date()
                }, {
                    attempts: 2,
                    backoff: { type: 'fixed', delay: 300000 }, // 5 minutes
                    removeOnComplete: true
                });
            }

            log.info(`${frequency} digest jobs scheduled for ${users.length} users`);
        } catch (error) {
            log.error(`Error scheduling ${frequency} digests:`, error);
            throw error;
        }
    }

    getHealth() {
        return {
            isRunning: this.isRunning,
            concurrency: this.concurrency,
            cronJobsActive: this.cronJobs.length,
            queueConnected: queueService.isConnected
        };
    }

    getHealthStatus() {
        return this.getHealth();
    }
}

// Create singleton instance
const budgetWorker = new BudgetWorker();

export default budgetWorker;
