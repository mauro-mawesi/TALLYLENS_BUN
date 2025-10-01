import FormData from 'form-data';
import fetch from 'node-fetch';
import { log } from '../utils/logger.js';

/**
 * Client for Document Processor Microservice (Python + OpenCV)
 * Handles perspective correction and advanced document processing
 */
class DocumentProcessorClient {
    constructor() {
        this.baseUrl = process.env.DOCUMENT_PROCESSOR_URL || 'http://document-processor:5000';
        this.timeout = 120000; // 2 minutes timeout
        this.enabled = true;
    }

    /**
     * Check if document processor service is available
     */
    async healthCheck() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                log.info('Document processor health check passed', data);
                return true;
            }

            log.warn('Document processor health check failed', {
                status: response.status
            });
            return false;
        } catch (error) {
            log.warn('Document processor service unavailable', {
                error: error.message,
                baseUrl: this.baseUrl
            });
            return false;
        }
    }

    /**
     * Process receipt image with Python OpenCV service
     * @param {Buffer} imageBuffer - Image to process
     * @param {Object} options - Processing options (fileName: just the filename, not full path)
     * @returns {Promise<Buffer>} Processed image buffer
     */
    async processReceipt(imageBuffer, options = {}) {
        if (!this.enabled) {
            throw new Error('Document processor is disabled');
        }

        // If fileName is provided, use path-based endpoint (most efficient)
        if (options.fileName) {
            return this.processReceiptByFileName(options.fileName);
        }

        // Otherwise fail (base64 not supported)
        return this.processReceiptBase64(imageBuffer);
    }

    /**
     * Process receipt by filename (for shared filesystem)
     * @param {string} fileName - Just the filename (e.g., "receipt.jpg"), not full path
     * @returns {Promise<Buffer>} Processed image buffer
     */
    async processReceiptByFileName(fileName) {
        if (!this.enabled) {
            throw new Error('Document processor is disabled');
        }

        try {
            log.info('Sending filename to document processor', {
                fileName: fileName,
                url: this.baseUrl
            });

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(`${this.baseUrl}/process-receipt`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileName }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Document processor failed: ${response.status} - ${errorText}`);
            }

            const result = await response.json();

            if (!result.success || !result.processed) {
                throw new Error('Processing failed on Python service');
            }

            // The processor now returns only the filename, not the full path
            const processedFileName = result.processedPath; // This is now just a filename

            log.info('Image processed successfully by filename', {
                inputFileName: fileName,
                processedFileName: processedFileName,
                format: result.format,
                metadata: result.metadata
            });

            // Construct the full path to read the processed file
            // Assuming processed files are in the same 'uploads' directory
            const path = await import('path');
            const processedFilePath = path.resolve('uploads', processedFileName);

            // Read the processed file
            const fs = await import('fs');
            const processedBuffer = fs.readFileSync(processedFilePath);

            // Return both the buffer and the processed filename
            return {
                buffer: processedBuffer,
                processedFileName: processedFileName
            };

        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Document processor timeout');
            }
            throw error;
        }
    }

    /**
     * Process receipt with base64 encoding (NOT SUPPORTED)
     * The Python document processor service only supports file path-based processing.
     * This method is kept for compatibility but will throw an error.
     * @param {Buffer} imageBuffer - Image to process
     * @returns {Promise<Buffer>} Processed image buffer
     */
    async processReceiptBase64(imageBuffer) {
        throw new Error('Base64 processing not supported by document processor. Please provide a filePath in options or save the image to disk first.');
    }

    /**
     * Disable the document processor (use fallback only)
     */
    disable() {
        this.enabled = false;
        log.warn('Document processor disabled');
    }

    /**
     * Enable the document processor
     */
    enable() {
        this.enabled = true;
        log.info('Document processor enabled');
    }
}

// Singleton instance
const documentProcessorClient = new DocumentProcessorClient();

export default documentProcessorClient;