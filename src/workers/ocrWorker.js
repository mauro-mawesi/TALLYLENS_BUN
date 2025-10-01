import queueService from '../services/queueService.js';
import { extractTextFromImage } from '../services/ocrService.js';
import Receipt from '../models/Receipt.js';
import { log } from '../utils/logger.js';
import cacheService from '../services/cacheService.js';
import crypto from 'crypto';

class OCRWorker {
    constructor() {
        this.isRunning = false;
    }

    start() {
        if (!queueService.isConnected) {
            log.warn('Queue service not connected, OCR worker not started');
            return;
        }

        if (this.isRunning) {
            log.warn('OCR worker is already running');
            return;
        }

        this.isRunning = true;

        // Process OCR jobs
        queueService.queues.ocr.process('process-ocr', this.concurrency, async (job) => {
            return await this.processOCR(job);
        });

        log.info('OCR worker started');
    }

    stop() {
        this.isRunning = false;
        log.info('OCR worker stopped');
    }

    get concurrency() {
        // Number of concurrent OCR jobs to process
        return process.env.OCR_CONCURRENCY || 2;
    }

    async processOCR(job) {
        const { receiptId, imageUrl } = job.data;
        const startTime = Date.now();

        try {
            log.info('Starting OCR processing', { receiptId, imageUrl });

            // Update receipt status
            const receipt = await Receipt.findByPk(receiptId);
            if (!receipt) {
                throw new Error(`Receipt ${receiptId} not found`);
            }

            await receipt.update({
                processingStatus: 'processing'
            });

            // Check cache first
            const imageHash = crypto.createHash('md5').update(imageUrl).digest('hex');
            let extractedText = await cacheService.getOCRResult(imageHash);

            if (!extractedText) {
                // Extract text from image
                extractedText = await extractTextFromImage(imageUrl);

                // Cache the result
                await cacheService.cacheOCRResult(imageHash, extractedText);
                log.debug('OCR result cached', { imageHash, textLength: extractedText.length });
            } else {
                log.debug('OCR result retrieved from cache', { imageHash });
            }

            // Update receipt with extracted text
            await receipt.update({
                rawText: extractedText,
                processingStatus: 'completed'
            });

            // Queue categorization job
            if (extractedText) {
                await queueService.addCategorizationJob(receiptId, extractedText);
            }

            // Invalidate cache
            await cacheService.invalidateReceiptData(receiptId);
            await cacheService.invalidateUserReceipts(receipt.userId);

            const processingTime = Date.now() - startTime;
            log.info('OCR processing completed', {
                receiptId,
                processingTime,
                textLength: extractedText.length
            });

            return {
                receiptId,
                extractedText,
                processingTime,
                success: true
            };

        } catch (error) {
            log.error('OCR processing failed', {
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

            // Re-throw error to mark job as failed
            throw error;
        }
    }

    // Health check for the worker
    getHealthStatus() {
        return {
            isRunning: this.isRunning,
            concurrency: this.concurrency,
            queueStatus: queueService.isConnected ? 'connected' : 'disconnected'
        };
    }
}

const ocrWorker = new OCRWorker();
export default ocrWorker;