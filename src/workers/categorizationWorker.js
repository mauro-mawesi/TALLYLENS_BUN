import queueService from '../services/queueService.js';
import { categorizeReceipt } from '../services/categorizationService.js';
import Receipt from '../models/Receipt.js';
import { log } from '../utils/logger.js';
import cacheService from '../services/cacheService.js';
import crypto from 'crypto';

class CategorizationWorker {
    constructor() {
        this.isRunning = false;
    }

    start() {
        if (!queueService.isConnected) {
            log.warn('Queue service not connected, categorization worker not started');
            return;
        }

        if (this.isRunning) {
            log.warn('Categorization worker is already running');
            return;
        }

        this.isRunning = true;

        // Process categorization jobs
        queueService.queues.categorization.process('categorize-receipt', this.concurrency, async (job) => {
            return await this.processCategorizationAlternative(job);
        });

        log.info('Categorization worker started');
    }

    stop() {
        this.isRunning = false;
        log.info('Categorization worker stopped');
    }

    get concurrency() {
        // Number of concurrent categorization jobs to process
        return process.env.CATEGORIZATION_CONCURRENCY || 3;
    }

    async processCategorization(job) {
        const { receiptId, extractedText } = job.data;
        const startTime = Date.now();

        try {
            log.info('Starting categorization processing', { receiptId });

            const receipt = await Receipt.findByPk(receiptId);
            if (!receipt) {
                throw new Error(`Receipt ${receiptId} not found`);
            }

            // Check cache first
            const textHash = crypto.createHash('md5').update(extractedText).digest('hex');
            let category = await cacheService.getCategoryResult(textHash);

            if (!category) {
                // Categorize the receipt
                category = await categorizeReceipt(extractedText);

                // Cache the result
                await cacheService.cacheCategoryResult(textHash, category);
                log.debug('Categorization result cached', { textHash, category });
            } else {
                log.debug('Categorization result retrieved from cache', { textHash, category });
            }

            // Update receipt with category
            await receipt.update({
                category: category,
                isProcessed: true,
                processingStatus: 'completed'
            });

            // Invalidate cache
            await cacheService.invalidateReceiptData(receiptId);
            await cacheService.invalidateUserReceipts(receipt.userId);
            await cacheService.invalidateUserStats(receipt.userId);

            // Queue statistics update job
            await queueService.addStatisticsJob('user-stats', receipt.userId);

            const processingTime = Date.now() - startTime;
            log.info('Categorization processing completed', {
                receiptId,
                category,
                processingTime
            });

            return {
                receiptId,
                category,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('Categorization processing failed', {
                receiptId,
                error: error.message,
                stack: error.stack
            });

            // Update receipt with error
            try {
                const receipt = await Receipt.findByPk(receiptId);
                if (receipt) {
                    await receipt.markAsFailed(error);
                }
            } catch (updateError) {
                log.error('Failed to update receipt with error status', updateError);
            }

            throw error;
        }
    }

    async processCategorizationAlternative(job) {
        const { receiptId, extractedText } = job.data;
        const startTime = Date.now();

        try {
            log.info('Starting alternative categorization processing', { receiptId });

            const receipt = await Receipt.findByPk(receiptId);
            if (!receipt) {
                throw new Error(`Receipt ${receiptId} not found`);
            }

            // Simple rule-based categorization as fallback
            let category = this.simpleCategorizationFallback(extractedText);

            // Try AI categorization first
            try {
                const textHash = crypto.createHash('md5').update(extractedText).digest('hex');
                let aiCategory = await cacheService.getCategoryResult(textHash);

                if (!aiCategory) {
                    aiCategory = await categorizeReceipt(extractedText);
                    await cacheService.cacheCategoryResult(textHash, aiCategory);
                }

                category = aiCategory;
            } catch (aiError) {
                log.warn('AI categorization failed, using fallback', {
                    receiptId,
                    error: aiError.message
                });
            }

            // Update receipt
            await receipt.update({
                category: category,
                isProcessed: true,
                processingStatus: 'completed'
            });

            // Invalidate cache
            await cacheService.invalidateReceiptData(receiptId);
            await cacheService.invalidateUserReceipts(receipt.userId);
            await cacheService.invalidateUserStats(receipt.userId);

            // Queue statistics update
            await queueService.addStatisticsJob('user-stats', receipt.userId);

            const processingTime = Date.now() - startTime;
            log.info('Alternative categorization completed', {
                receiptId,
                category,
                processingTime
            });

            return {
                receiptId,
                category,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('Alternative categorization failed', {
                receiptId,
                error: error.message
            });

            try {
                const receipt = await Receipt.findByPk(receiptId);
                if (receipt) {
                    await receipt.markAsFailed(error);
                }
            } catch (updateError) {
                log.error('Failed to update receipt with error status', updateError);
            }

            throw error;
        }
    }

    simpleCategorizationFallback(text) {
        const lowerText = text.toLowerCase();

        // Define keywords for each category
        const categories = {
            'Mercado': [
                'supermercado', 'market', 'grocery', 'walmart', 'carrefour', 'jumbo',
                'verduras', 'frutas', 'leche', 'pan', 'carne', 'pollo', 'pescado',
                'alimentos', 'comestibles', 'food', 'vegetables', 'meat'
            ],
            'Transporte': [
                'gasolina', 'gas', 'combustible', 'fuel', 'station', 'estacion',
                'taxi', 'uber', 'metro', 'bus', 'transporte', 'transport',
                'peaje', 'toll', 'parking', 'estacionamiento'
            ],
            'Comida': [
                'restaurant', 'restaurante', 'cafe', 'cafeteria', 'pizza',
                'burger', 'comida', 'food', 'delivery', 'pedido', 'menu',
                'mcdonald', 'kfc', 'subway', 'domino', 'bar', 'pub'
            ],
            'Combustible': [
                'shell', 'esso', 'bp', 'chevron', 'petrol', 'diesel',
                'nafta', 'combustible', 'fuel', 'gas station', 'estacion de servicio'
            ]
        };

        // Check each category
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => lowerText.includes(keyword))) {
                return category;
            }
        }

        // Default category
        return 'Otros';
    }

    getHealthStatus() {
        return {
            isRunning: this.isRunning,
            concurrency: this.concurrency,
            queueStatus: queueService.isConnected ? 'connected' : 'disconnected'
        };
    }
}

const categorizationWorker = new CategorizationWorker();
export default categorizationWorker;