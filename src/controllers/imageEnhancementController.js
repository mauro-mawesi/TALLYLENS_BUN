import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import imageEnhancementService from '../services/imageEnhancementService.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Preview enhanced version of a receipt image
 * Useful for testing and debugging image processing
 */
export const previewEnhancedImage = asyncHandler(async (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({
            status: 'error',
            message: 'Image URL is required'
        });
    }

    try {
        let imagePath;
        let imageBuffer;

        // Handle local uploads
        if (imageUrl.includes('/uploads/')) {
            const fileName = path.basename(imageUrl);
            imagePath = path.join(process.cwd(), 'uploads', fileName);
            imageBuffer = await fs.readFile(imagePath);
        } else {
            // Handle external URLs
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        }

        // Analyze image quality
        const analysis = await imageEnhancementService.analyzeImageQuality(imageBuffer);

        // Enhance image
        const enhancedBuffer = await imageEnhancementService.enhanceReceiptImage(imageBuffer);

        // Generate comparison metrics
        const comparison = await imageEnhancementService.compareImages(imageBuffer, enhancedBuffer);

        // Save temporary enhanced version
        const tempFileName = `enhanced_${uuidv4()}.jpg`;
        const tempPath = path.join(process.cwd(), 'uploads', 'temp', tempFileName);

        // Ensure temp directory exists
        await fs.mkdir(path.dirname(tempPath), { recursive: true });

        // Save enhanced image
        await fs.writeFile(tempPath, enhancedBuffer);

        // Generate URL for enhanced image
        const enhancedUrl = `${req.protocol}://${req.get('host')}/uploads/temp/${tempFileName}`;

        log.info('Image enhancement preview generated', {
            originalUrl: imageUrl,
            enhancedUrl,
            analysis,
            comparison
        });

        res.json({
            status: 'success',
            data: {
                original: imageUrl,
                enhanced: enhancedUrl,
                analysis,
                comparison,
                expiresIn: '10 minutes'
            }
        });

    } catch (error) {
        log.error('Error previewing enhanced image', {
            imageUrl,
            error: error.message
        });

        res.status(500).json({
            status: 'error',
            message: 'Failed to enhance image',
            details: error.message
        });
    }
});

/**
 * Batch enhance multiple images
 * Useful for preprocessing before OCR
 */
export const batchEnhanceImages = asyncHandler(async (req, res) => {
    const { imageUrls } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls)) {
        return res.status(400).json({
            status: 'error',
            message: 'Array of image URLs is required'
        });
    }

    const results = [];
    const errors = [];

    for (const imageUrl of imageUrls) {
        try {
            let imageBuffer;

            if (imageUrl.includes('/uploads/')) {
                const fileName = path.basename(imageUrl);
                const imagePath = path.join(process.cwd(), 'uploads', fileName);
                imageBuffer = await fs.readFile(imagePath);
            } else {
                const response = await fetch(imageUrl);
                const arrayBuffer = await response.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuffer);
            }

            // Enhance image
            const enhancedBuffer = await imageEnhancementService.enhanceReceiptImage(imageBuffer);

            // Save enhanced version
            const fileName = `enhanced_${uuidv4()}.jpg`;
            const enhancedPath = path.join(process.cwd(), 'uploads', 'enhanced', fileName);

            await fs.mkdir(path.dirname(enhancedPath), { recursive: true });
            await fs.writeFile(enhancedPath, enhancedBuffer);

            results.push({
                original: imageUrl,
                enhanced: `${req.protocol}://${req.get('host')}/uploads/enhanced/${fileName}`,
                success: true
            });

        } catch (error) {
            errors.push({
                original: imageUrl,
                error: error.message,
                success: false
            });
        }
    }

    log.info('Batch enhancement completed', {
        total: imageUrls.length,
        successful: results.length,
        failed: errors.length
    });

    res.json({
        status: 'success',
        data: {
            processed: imageUrls.length,
            successful: results,
            failed: errors
        }
    });
});

/**
 * Analyze image quality without enhancement
 * Returns quality metrics and recommendations
 */
export const analyzeImageQuality = asyncHandler(async (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({
            status: 'error',
            message: 'Image URL is required'
        });
    }

    try {
        let imageBuffer;

        if (imageUrl.includes('/uploads/')) {
            const fileName = path.basename(imageUrl);
            const imagePath = path.join(process.cwd(), 'uploads', fileName);
            imageBuffer = await fs.readFile(imagePath);
        } else {
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        }

        // Analyze image
        const analysis = await imageEnhancementService.analyzeImageQuality(imageBuffer);

        // Generate recommendations
        const recommendations = [];

        if (analysis.needsEnhancement) {
            if (analysis.reasons.includes('brightness_issue')) {
                recommendations.push({
                    issue: 'brightness',
                    action: analysis.quality.brightness < 0.3 ? 'increase_brightness' : 'decrease_brightness',
                    description: 'Image is too dark or too bright for optimal OCR'
                });
            }

            if (analysis.reasons.includes('low_contrast')) {
                recommendations.push({
                    issue: 'contrast',
                    action: 'increase_contrast',
                    description: 'Low contrast may affect text recognition'
                });
            }

            if (analysis.reasons.includes('oversized')) {
                recommendations.push({
                    issue: 'size',
                    action: 'resize',
                    description: 'Image is too large and should be resized'
                });
            }
        }

        res.json({
            status: 'success',
            data: {
                imageUrl,
                analysis,
                recommendations,
                needsEnhancement: analysis.needsEnhancement
            }
        });

    } catch (error) {
        log.error('Error analyzing image quality', {
            imageUrl,
            error: error.message
        });

        res.status(500).json({
            status: 'error',
            message: 'Failed to analyze image',
            details: error.message
        });
    }
});

/**
 * Clean up temporary enhanced images
 * Should be called periodically
 */
export const cleanupTempImages = asyncHandler(async (req, res) => {
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');

    try {
        const files = await fs.readdir(tempDir);
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        let deleted = 0;

        for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = await fs.stat(filePath);

            if (now - stats.mtime.getTime() > maxAge) {
                await fs.unlink(filePath);
                deleted++;
            }
        }

        log.info('Temporary images cleanup completed', {
            totalFiles: files.length,
            deletedFiles: deleted
        });

        res.json({
            status: 'success',
            data: {
                totalFiles: files.length,
                deletedFiles: deleted
            }
        });

    } catch (error) {
        log.error('Error cleaning up temp images', {
            error: error.message
        });

        res.status(500).json({
            status: 'error',
            message: 'Failed to cleanup temp images',
            details: error.message
        });
    }
});