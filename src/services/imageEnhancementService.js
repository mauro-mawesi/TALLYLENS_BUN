import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { log } from '../utils/logger.js';
import documentProcessorClient from './documentProcessorClient.js';

/**
 * Service for enhancing receipt images before OCR processing
 * Uses Python OpenCV microservice for advanced processing (perspective correction)
 * Falls back to Sharp-only processing if microservice is unavailable
 */

class ImageEnhancementService {
    constructor() {
        this.defaultOptions = {
            maxWidth: 4000,                    // Increased: preserve more quality
            maxHeight: 4000,
            quality: 100,                      // Lossless quality
            format: 'png',                     // PNG for lossless compression
            grayscale: false,                  // DISABLED: Keep color (better for OCR)
            normalize: false,                  // DISABLED: Don't normalize well-exposed images
            sharpen: false,                    // DISABLED: Don't add artificial sharpening
            contrast: 1.0,                     // DISABLED: No contrast adjustment
            brightness: 1.0,                   // DISABLED: No brightness adjustment
            autoRotate: false,
            skipPerspectiveCorrection: false,  // Set to true if already processed by ML Kit
            usePythonProcessor: true           // Try Python OpenCV service first
        };

        // Check Python service availability on startup
        this.checkPythonServiceAvailability();
    }

    async checkPythonServiceAvailability() {
        const isAvailable = await documentProcessorClient.healthCheck();
        if (!isAvailable) {
            log.warn('Python document processor not available, will use Sharp fallback');
        } else {
            log.info('Python document processor available and ready');
        }
    }

    /**
     * Main enhancement pipeline for receipt images
     * @param {string|Buffer} input - Image path or buffer
     * @param {Object} options - Enhancement options
     * @returns {Promise<Buffer>} Enhanced image buffer
     */
    async enhanceReceiptImage(input, options = {}) {
        const opts = { ...this.defaultOptions, ...options };

        try {
            // Step 1: Load and prepare image
            let imageBuffer;
            if (typeof input === 'string') {
                imageBuffer = await fs.readFile(input);
            } else {
                imageBuffer = input;
            }

            // Step 2: Try Python OpenCV processor first (if enabled and not skipped)
            if (opts.usePythonProcessor && !opts.skipPerspectiveCorrection) {
                try {
                    log.info('Attempting Python OpenCV processing (perspective correction + orientation + crop)');

                    // Use fileName from options (just the filename, not full path)
                    const processorOptions = {};
                    if (opts.fileName) {
                        processorOptions.fileName = opts.fileName;
                    } else if (typeof input === 'string') {
                        // If input is a string, extract just the filename
                        const path = await import('path');
                        processorOptions.fileName = path.basename(input);
                    }

                    const result = await documentProcessorClient.processReceipt(imageBuffer, processorOptions);

                    log.info('Python OpenCV processing completed successfully', {
                        processedFileName: result.processedFileName
                    });

                    // Return both the buffer and the processed filename
                    return {
                        buffer: result.buffer,
                        processedFileName: result.processedFileName
                    };
                } catch (pythonError) {
                    log.warn('Python processor failed, falling back to Sharp-only pipeline', {
                        error: pythonError.message
                    });
                    // Continue to Sharp fallback below
                }
            } else if (opts.skipPerspectiveCorrection) {
                log.info('Skipping perspective correction (image already processed by ML Kit)');
            } else {
                log.info('Python processor disabled, using Sharp-only pipeline');
            }

            // Step 3: Sharp-only fallback pipeline
            log.info('Starting Sharp-only fallback pipeline');

            // Step 3a: Detect orientation and rotate if needed (BEFORE any processing)
            let processedBuffer = imageBuffer;
            const orientation = await this.detectReceiptOrientation(imageBuffer);

            if (orientation.needsRotation) {
                try {
                    processedBuffer = await sharp(imageBuffer)
                        .rotate(orientation.angle)
                        .toBuffer();
                    log.info('Receipt rotated for correct orientation', {
                        angle: orientation.angle,
                        reason: orientation.reason
                    });
                } catch (rotateError) {
                    log.warn('Rotation failed, using original', { error: rotateError.message });
                    processedBuffer = imageBuffer;
                }
            }

            // Step 3: Initial resize to manageable size (NEVER auto-rotate)
            const resized = await sharp(processedBuffer, {
                failOnError: false,
                autoRotate: false // CRITICAL: Never auto-rotate, we handle it manually
            })
                .resize(opts.maxWidth, opts.maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toBuffer();

            // Step 4: Intelligent multi-strategy cropping
            // Note: Perspective correction is NOT done here (requires OpenCV/ML Kit)
            // For best results, use ML Kit Scanner in Flutter app
            let croppedBuffer;
            try {
                croppedBuffer = await this.intelligentCrop(resized);
                log.info('Intelligent crop successful');
            } catch (cropError) {
                log.error('All crop strategies failed, using conservative fallback', {
                    error: cropError.message
                });

                try {
                    // Final fallback: conservative crop with fixed margin
                    croppedBuffer = await this.conservativeCrop(resized, 0.08);
                    log.info('Conservative crop applied as fallback');
                } catch (conservativeError) {
                    log.error('Even conservative crop failed, using resized image', {
                        error: conservativeError.message
                    });
                    croppedBuffer = resized;
                }
            }

            // Step 5: Apply minimal enhancements (quality preserving)
            const enhanced = await this.applyEnhancements(croppedBuffer, opts);

            log.info('Image enhancement completed successfully');
            return enhanced;

        } catch (error) {
            log.error('Error enhancing image', { error: error.message, stack: error.stack });
            // Fallback: return original image with basic improvements
            try {
                const original = typeof input === 'string' ? await fs.readFile(input) : input;
                return await this.basicEnhancement(original);
            } catch (fallbackError) {
                log.error('Even basic enhancement failed', { error: fallbackError.message });
                return typeof input === 'string' ? await fs.readFile(input) : input;
            }
        }
    }

    /**
     * Intelligent crop using multiple strategies with scoring
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Buffer>} Best cropped image
     */
    async intelligentCrop(imageBuffer) {
        const results = [];

        log.debug('Starting intelligent crop with multiple strategies');

        // Strategy 1: Trim whitespace (fast)
        try {
            const trimmed = await this.trimWhitespace(imageBuffer);
            const score = await this.scoreCrop(trimmed);
            results.push({ method: 'trim', buffer: trimmed, score });
            log.debug('Trim strategy completed', { score });
        } catch (e) {
            log.debug('Trim strategy failed', { error: e.message });
        }

        // Strategy 2: Edge detection with low blur (good for clean backgrounds)
        try {
            const edgeLow = await this.edgeDetectionCrop(imageBuffer, { blurSigma: 2 });
            const score = await this.scoreCrop(edgeLow);
            results.push({ method: 'edge-low-blur', buffer: edgeLow, score });
            log.debug('Edge detection (low blur) completed', { score });
        } catch (e) {
            log.debug('Edge detection (low blur) failed', { error: e.message });
        }

        // Strategy 3: Edge detection with high blur (good for complex backgrounds)
        try {
            const edgeHigh = await this.edgeDetectionCrop(imageBuffer, { blurSigma: 8 });
            const score = await this.scoreCrop(edgeHigh);
            results.push({ method: 'edge-high-blur', buffer: edgeHigh, score });
            log.debug('Edge detection (high blur) completed', { score });
        } catch (e) {
            log.debug('Edge detection (high blur) failed', { error: e.message });
        }

        // Strategy 4: Smart content crop
        try {
            const smart = await this.smartContentCrop(imageBuffer);
            const score = await this.scoreCrop(smart);
            results.push({ method: 'smart-content', buffer: smart, score });
            log.debug('Smart content crop completed', { score });
        } catch (e) {
            log.debug('Smart content crop failed', { error: e.message });
        }

        // Choose the best result
        if (results.length === 0) {
            throw new Error('All crop strategies failed');
        }

        results.sort((a, b) => b.score - a.score);
        const best = results[0];

        log.info('Intelligent crop selected best strategy', {
            method: best.method,
            score: best.score.toFixed(2),
            totalAttempts: results.length
        });

        return best.buffer;
    }

    /**
     * Trim whitespace from edges
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Buffer>} Trimmed image
     */
    async trimWhitespace(imageBuffer) {
        const metadata = await sharp(imageBuffer).metadata();

        const trimmed = await sharp(imageBuffer)
            .trim({
                background: { r: 255, g: 255, b: 255 },
                threshold: 10
            })
            .toBuffer();

        const trimmedMeta = await sharp(trimmed).metadata();
        const trimPercentage = ((metadata.width * metadata.height) - (trimmedMeta.width * trimmedMeta.height)) / (metadata.width * metadata.height);

        // Validate that trim is reasonable (between 5% and 70%)
        if (trimPercentage < 0.05 || trimPercentage > 0.70) {
            throw new Error(`Trim percentage ${(trimPercentage * 100).toFixed(1)}% is outside acceptable range`);
        }

        return trimmed;
    }

    /**
     * Conservative crop with fixed margin
     * @param {Buffer} imageBuffer - Input image
     * @param {number} marginPercent - Margin as percentage (0.08 = 8%)
     * @returns {Promise<Buffer>} Cropped image
     */
    async conservativeCrop(imageBuffer, marginPercent = 0.08) {
        const meta = await sharp(imageBuffer).metadata();

        const marginX = Math.floor(meta.width * marginPercent);
        const marginY = Math.floor(meta.height * marginPercent);

        log.debug('Applying conservative crop', {
            margin: `${(marginPercent * 100).toFixed(1)}%`,
            marginPixels: `${marginX}x${marginY}`
        });

        return await sharp(imageBuffer)
            .extract({
                left: marginX,
                top: marginY,
                width: meta.width - (marginX * 2),
                height: meta.height - (marginY * 2)
            })
            .toBuffer();
    }

    /**
     * Score crop quality
     * @param {Buffer} imageBuffer - Cropped image
     * @returns {Promise<number>} Quality score (higher is better)
     */
    async scoreCrop(imageBuffer) {
        try {
            const meta = await sharp(imageBuffer).metadata();
            const stats = await sharp(imageBuffer).stats();

            let score = 0;

            // Penalize very small images (likely over-cropped)
            const area = meta.width * meta.height;
            if (area < 200000) score -= 15;
            if (area < 100000) score -= 30; // Very severe penalty

            // Penalize very large images (likely under-cropped)
            if (area > 2500000) score -= 10;

            // Reward good contrast (indicates clear content)
            const contrast = this.calculateContrast(stats);
            score += contrast * 40;

            // Reward typical receipt aspect ratio (vertical, narrow)
            const aspectRatio = meta.width / meta.height;
            if (aspectRatio > 0.3 && aspectRatio < 0.7) {
                score += 25; // Perfect receipt proportions
            } else if (aspectRatio > 0.2 && aspectRatio < 0.9) {
                score += 10; // Acceptable proportions
            } else {
                score -= 10; // Unusual proportions
            }

            // Penalize extreme brightness (indicates corruption or bad crop)
            const brightness = this.calculateBrightness(stats);
            if (brightness < 0.15 || brightness > 0.90) {
                score -= 25; // Likely corrupted or wrong crop
            } else if (brightness > 0.3 && brightness < 0.7) {
                score += 10; // Good brightness range
            }

            // Reward larger dimensions (more content, as long as not too large)
            if (area > 300000 && area < 2000000) {
                score += 15;
            }

            log.debug('Crop scoring', {
                area,
                aspectRatio: aspectRatio.toFixed(2),
                contrast: contrast.toFixed(2),
                brightness: brightness.toFixed(2),
                finalScore: score.toFixed(2)
            });

            return score;

        } catch (error) {
            log.error('Error scoring crop', { error: error.message });
            return -100; // Worst possible score
        }
    }

    /**
     * Detect receipt orientation based on aspect ratio
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Object>} Orientation info
     */
    async detectReceiptOrientation(imageBuffer) {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const aspectRatio = metadata.width / metadata.height;

            log.debug('Analyzing receipt orientation', {
                width: metadata.width,
                height: metadata.height,
                aspectRatio: aspectRatio.toFixed(2)
            });

            // Receipts are typically vertical (portrait)
            // If width > height significantly, it's likely horizontal and needs rotation
            if (aspectRatio > 1.5) {
                return {
                    needsRotation: true,
                    angle: 90,
                    reason: `Horizontal receipt detected (aspect ratio: ${aspectRatio.toFixed(2)})`
                };
            }

            // If slightly horizontal but not extreme, might still be a receipt
            if (aspectRatio > 1.2) {
                return {
                    needsRotation: true,
                    angle: 90,
                    reason: `Likely horizontal receipt (aspect ratio: ${aspectRatio.toFixed(2)})`
                };
            }

            return {
                needsRotation: false,
                angle: 0,
                reason: `Vertical receipt (aspect ratio: ${aspectRatio.toFixed(2)})`
            };

        } catch (error) {
            log.error('Error detecting orientation', { error: error.message });
            return { needsRotation: false, angle: 0, reason: 'Detection failed' };
        }
    }

    /**
     * Edge detection based cropping using Sharp with multiple strategies
     * @param {Buffer} imageBuffer - Input image
     * @param {Object} options - Processing options
     * @returns {Promise<Buffer>} Cropped image
     */
    async edgeDetectionCrop(imageBuffer, options = {}) {
        const { blurSigma = 5 } = options;
        try {
            const metadata = await sharp(imageBuffer).metadata();

            log.debug('Starting edge detection crop', {
                originalSize: `${metadata.width}x${metadata.height}`
            });

            // Strategy 1: Trim whitespace/borders automatically
            try {
                const trimmed = await sharp(imageBuffer)
                    .trim({
                        background: { r: 255, g: 255, b: 255 },
                        threshold: 10
                    })
                    .toBuffer();

                const trimmedMeta = await sharp(trimmed).metadata();
                const trimPercentage = ((metadata.width * metadata.height) - (trimmedMeta.width * trimmedMeta.height)) / (metadata.width * metadata.height);

                // If trim removed more than 5% but less than 70%, it's probably good
                if (trimPercentage > 0.05 && trimPercentage < 0.70) {
                    log.info('Automatic trim successful', {
                        trimPercentage: (trimPercentage * 100).toFixed(2) + '%',
                        newSize: `${trimmedMeta.width}x${trimmedMeta.height}`
                    });
                    return trimmed;
                }
            } catch (trimError) {
                log.debug('Automatic trim failed or not applicable', { error: trimError.message });
            }

            // Strategy 2: Enhanced edge detection with stronger preprocessing
            // Use stronger blur to eliminate background texture (wood, fabric, etc.)
            const preprocessed = await sharp(imageBuffer)
                .grayscale()
                .blur(blurSigma) // INCREASED: 1 → 5 (eliminates texture)
                .normalize()
                .modulate({ brightness: 1.3, contrast: 1.2 }) // More contrast
                .toBuffer();

            // Apply median filter to remove small noise before edge detection
            const denoised = await sharp(preprocessed)
                .median(5)
                .toBuffer();

            // Apply combined Sobel (X + Y) for better edge detection
            const sobelX = await sharp(denoised)
                .convolve({
                    width: 3,
                    height: 3,
                    kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
                    scale: 1,
                    offset: 0
                })
                .toBuffer();

            const sobelY = await sharp(denoised)
                .convolve({
                    width: 3,
                    height: 3,
                    kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
                    scale: 1,
                    offset: 0
                })
                .toBuffer();

            // Combine both Sobel results
            const combined = await sharp(sobelX)
                .composite([{ input: sobelY, blend: 'add' }])
                .normalize()
                .threshold(80) // REDUCED: 120 → 80 (keep more edge information)
                .toBuffer();

            // Get raw pixel data
            const { data, info } = await sharp(combined).raw().toBuffer({ resolveWithObject: true });

            // Find content boundaries
            const boundaries = this.findContentBoundaries(data, info.width, info.height);

            log.debug('Boundaries detected', boundaries);

            // Validate boundaries - be more lenient
            const minWidth = Math.floor(metadata.width * 0.2);
            const minHeight = Math.floor(metadata.height * 0.2);

            if (boundaries.width < minWidth || boundaries.height < minHeight) {
                log.warn('Detected boundaries too small', {
                    detected: `${boundaries.width}x${boundaries.height}`,
                    minimum: `${minWidth}x${minHeight}`
                });
                throw new Error('Boundaries too small');
            }

            // Calculate extraction region with smart padding
            const paddingPercent = 0.02; // 2% padding
            const paddingX = Math.max(10, Math.floor(boundaries.width * paddingPercent));
            const paddingY = Math.max(10, Math.floor(boundaries.height * paddingPercent));

            const extractRegion = {
                left: Math.max(0, boundaries.left - paddingX),
                top: Math.max(0, boundaries.top - paddingY),
                width: Math.min(metadata.width, boundaries.width + (paddingX * 2)),
                height: Math.min(metadata.height, boundaries.height + (paddingY * 2))
            };

            // Ensure extraction region is within image bounds
            if (extractRegion.left + extractRegion.width > metadata.width) {
                extractRegion.width = metadata.width - extractRegion.left;
            }
            if (extractRegion.top + extractRegion.height > metadata.height) {
                extractRegion.height = metadata.height - extractRegion.top;
            }

            // Apply cropping
            const cropped = await sharp(imageBuffer)
                .extract(extractRegion)
                .toBuffer();

            log.info('Edge detection cropping successful', {
                originalSize: `${metadata.width}x${metadata.height}`,
                croppedSize: `${extractRegion.width}x${extractRegion.height}`,
                croppedPercentage: ((extractRegion.width * extractRegion.height) / (metadata.width * metadata.height) * 100).toFixed(1) + '%'
            });

            return cropped;

        } catch (error) {
            log.error('Edge detection cropping failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Smart content-based cropping
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Buffer>} Cropped image
     */
    async smartContentCrop(imageBuffer) {
        try {
            const metadata = await sharp(imageBuffer).metadata();

            // Convert to grayscale and get histogram
            const { data, info } = await sharp(imageBuffer)
                .grayscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            // Analyze content distribution to find the main document area
            const contentArea = this.analyzeContentDistribution(data, info.width, info.height);

            // Ensure we have a reasonable crop area
            const minWidth = Math.min(400, Math.floor(metadata.width * 0.5));
            const minHeight = Math.min(600, Math.floor(metadata.height * 0.5));

            if (contentArea.width < minWidth || contentArea.height < minHeight) {
                // If content area is too small, use conservative crop
                const cropMargin = Math.min(
                    Math.floor(metadata.width * 0.1),
                    Math.floor(metadata.height * 0.1),
                    50
                );

                return await sharp(imageBuffer, { autoRotate: false })
                    .extract({
                        left: cropMargin,
                        top: cropMargin,
                        width: metadata.width - (cropMargin * 2),
                        height: metadata.height - (cropMargin * 2)
                    })
                    .toBuffer();
            }

            // Apply the smart crop
            const cropped = await sharp(imageBuffer, { autoRotate: false })
                .extract({
                    left: contentArea.left,
                    top: contentArea.top,
                    width: contentArea.width,
                    height: contentArea.height
                })
                .toBuffer();

            log.info('Smart content cropping applied', {
                originalSize: `${metadata.width}x${metadata.height}`,
                contentArea: contentArea
            });

            return cropped;

        } catch (error) {
            log.error('Smart content cropping failed', { error: error.message });
            // Ultra-safe fallback
            return imageBuffer;
        }
    }

    /**
     * Find content boundaries using pixel analysis with improved algorithm
     * @param {Buffer} data - Raw pixel data
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Object} Boundary coordinates
     */
    findContentBoundaries(data, width, height) {
        // Analyze rows and columns for content density
        const rowDensity = new Array(height).fill(0);
        const colDensity = new Array(width).fill(0);

        // Calculate density for each row and column
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelValue = data[y * width + x];
                if (pixelValue > 128) { // White/light pixels (edges)
                    rowDensity[y]++;
                    colDensity[x]++;
                }
            }
        }

        // Calculate adaptive threshold based on statistical analysis
        const rowStats = this.calculateDensityStats(rowDensity);
        const colStats = this.calculateDensityStats(colDensity);

        // Use median + standard deviation for more robust threshold
        const rowThreshold = Math.max(5, rowStats.median + (rowStats.stdDev * 0.5));
        const colThreshold = Math.max(5, colStats.median + (colStats.stdDev * 0.5));

        let top = 0, bottom = height - 1;
        let left = 0, right = width - 1;

        // Find top boundary with smoothing
        let consecutiveHighDensity = 0;
        const requiredConsecutive = 3;
        for (let y = 0; y < height; y++) {
            if (rowDensity[y] > rowThreshold) {
                consecutiveHighDensity++;
                if (consecutiveHighDensity >= requiredConsecutive) {
                    top = Math.max(0, y - requiredConsecutive + 1);
                    break;
                }
            } else {
                consecutiveHighDensity = 0;
            }
        }

        // Find bottom boundary with smoothing
        consecutiveHighDensity = 0;
        for (let y = height - 1; y >= 0; y--) {
            if (rowDensity[y] > rowThreshold) {
                consecutiveHighDensity++;
                if (consecutiveHighDensity >= requiredConsecutive) {
                    bottom = Math.min(height - 1, y + requiredConsecutive - 1);
                    break;
                }
            } else {
                consecutiveHighDensity = 0;
            }
        }

        // Find left boundary with smoothing
        consecutiveHighDensity = 0;
        for (let x = 0; x < width; x++) {
            if (colDensity[x] > colThreshold) {
                consecutiveHighDensity++;
                if (consecutiveHighDensity >= requiredConsecutive) {
                    left = Math.max(0, x - requiredConsecutive + 1);
                    break;
                }
            } else {
                consecutiveHighDensity = 0;
            }
        }

        // Find right boundary with smoothing
        consecutiveHighDensity = 0;
        for (let x = width - 1; x >= 0; x--) {
            if (colDensity[x] > colThreshold) {
                consecutiveHighDensity++;
                if (consecutiveHighDensity >= requiredConsecutive) {
                    right = Math.min(width - 1, x + requiredConsecutive - 1);
                    break;
                }
            } else {
                consecutiveHighDensity = 0;
            }
        }

        // Ensure valid dimensions
        const detectedWidth = right - left;
        const detectedHeight = bottom - top;

        log.debug('Content boundaries detected', {
            top, bottom, left, right,
            width: detectedWidth,
            height: detectedHeight,
            rowThreshold,
            colThreshold
        });

        return {
            left: left,
            top: top,
            width: Math.max(1, detectedWidth),
            height: Math.max(1, detectedHeight)
        };
    }

    /**
     * Calculate statistical measures for density array
     * @param {Array<number>} densityArray - Array of density values
     * @returns {Object} Statistics (median, mean, stdDev)
     */
    calculateDensityStats(densityArray) {
        const sorted = [...densityArray].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const mean = densityArray.reduce((sum, val) => sum + val, 0) / densityArray.length;
        const variance = densityArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / densityArray.length;
        const stdDev = Math.sqrt(variance);

        return { median, mean, stdDev };
    }

    /**
     * Analyze content distribution for smart cropping
     * @param {Buffer} data - Raw pixel data
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Object} Content area coordinates
     */
    analyzeContentDistribution(data, width, height) {
        // Divide image into grid and analyze variance in each section
        const gridSize = 20;
        const sectionsX = Math.floor(width / gridSize);
        const sectionsY = Math.floor(height / gridSize);

        const sectionVariance = [];

        for (let sy = 0; sy < sectionsY; sy++) {
            sectionVariance[sy] = [];
            for (let sx = 0; sx < sectionsX; sx++) {
                const variance = this.calculateSectionVariance(
                    data, width,
                    sx * gridSize, sy * gridSize,
                    gridSize, gridSize
                );
                sectionVariance[sy][sx] = variance;
            }
        }

        // Find the area with highest content density (variance)
        let maxVariance = 0;
        let bestSection = { x: 0, y: 0 };

        for (let sy = 0; sy < sectionsY; sy++) {
            for (let sx = 0; sx < sectionsX; sx++) {
                if (sectionVariance[sy][sx] > maxVariance) {
                    maxVariance = sectionVariance[sy][sx];
                    bestSection = { x: sx, y: sy };
                }
            }
        }

        // Expand around the best section to include nearby high-variance areas
        const highVarianceThreshold = maxVariance * 0.3;
        let minX = bestSection.x, maxX = bestSection.x;
        let minY = bestSection.y, maxY = bestSection.y;

        // Expand horizontally
        for (let sx = 0; sx < sectionsX; sx++) {
            if (sectionVariance[bestSection.y][sx] > highVarianceThreshold) {
                minX = Math.min(minX, sx);
                maxX = Math.max(maxX, sx);
            }
        }

        // Expand vertically
        for (let sy = 0; sy < sectionsY; sy++) {
            if (sectionVariance[sy][bestSection.x] > highVarianceThreshold) {
                minY = Math.min(minY, sy);
                maxY = Math.max(maxY, sy);
            }
        }

        return {
            left: minX * gridSize,
            top: minY * gridSize,
            width: (maxX - minX + 1) * gridSize,
            height: (maxY - minY + 1) * gridSize
        };
    }

    /**
     * Calculate variance in a section of the image
     * @param {Buffer} data - Raw pixel data
     * @param {number} width - Image width
     * @param {number} startX - Section start X
     * @param {number} startY - Section start Y
     * @param {number} sectionW - Section width
     * @param {number} sectionH - Section height
     * @returns {number} Variance value
     */
    calculateSectionVariance(data, width, startX, startY, sectionW, sectionH) {
        const pixels = [];

        for (let y = startY; y < startY + sectionH; y++) {
            for (let x = startX; x < startX + sectionW; x++) {
                if (y * width + x < data.length) {
                    pixels.push(data[y * width + x]);
                }
            }
        }

        if (pixels.length === 0) return 0;

        const mean = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;
        const variance = pixels.reduce((sum, pixel) => sum + Math.pow(pixel - mean, 2), 0) / pixels.length;

        return variance;
    }


    /**
     * Apply MINIMAL enhancements - preserve quality as much as possible
     * Philosophy: Modern smartphone photos are already excellent quality
     * Only resize if absolutely necessary, preserve all other aspects
     *
     * @param {Buffer} imageBuffer - Input image
     * @param {Object} opts - Enhancement options
     * @returns {Promise<Buffer>} Enhanced image
     */
    async applyEnhancements(imageBuffer, opts) {
        const metadata = await sharp(imageBuffer).metadata();

        log.info('Applying minimal enhancements', {
            originalSize: `${metadata.width}x${metadata.height}`,
            format: metadata.format,
            preserveColor: !opts.grayscale
        });

        let pipeline = sharp(imageBuffer, { autoRotate: false });

        // ONLY resize if image is extremely large (over maxWidth/maxHeight)
        if (metadata.width > opts.maxWidth || metadata.height > opts.maxHeight) {
            log.info('Resizing large image', {
                from: `${metadata.width}x${metadata.height}`,
                maxDimensions: `${opts.maxWidth}x${opts.maxHeight}`
            });

            pipeline = pipeline.resize(opts.maxWidth, opts.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true,
                kernel: 'lanczos3'  // Best quality resampling
            });
        }

        // Save in optimal format with maximum quality
        if (opts.format === 'png') {
            // PNG: Lossless compression
            return await pipeline
                .png({
                    quality: 100,
                    compressionLevel: 6,  // Balance speed/size
                    palette: false        // Full color
                })
                .toBuffer();
        } else {
            // JPEG: High quality with minimal loss
            return await pipeline
                .jpeg({
                    quality: opts.quality,
                    chromaSubsampling: '4:4:4',  // No chroma subsampling
                    mozjpeg: true                // Better JPEG encoder
                })
                .toBuffer();
        }
    }

    /**
     * Basic enhancement fallback
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Buffer>} Basic enhanced image
     */
    async basicEnhancement(imageBuffer) {
        try {
            return await sharp(imageBuffer)
                .resize(1500, 2000, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .grayscale()
                .normalize()
                .sharpen()
                .jpeg({ quality: 90 })
                .toBuffer();
        } catch (error) {
            log.error('Basic enhancement failed', { error: error.message });
            return imageBuffer;
        }
    }

    /**
     * Auto-rotate image based on EXIF data
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Buffer>} Rotated image
     */
    async autoRotate(imageBuffer) {
        try {
            return await sharp(imageBuffer)
                .rotate()
                .toBuffer();
        } catch (error) {
            log.warn('Auto-rotate failed', { error: error.message });
            return imageBuffer;
        }
    }

    /**
     * Detect if image needs enhancement
     * @param {Buffer} imageBuffer - Input image
     * @returns {Promise<Object>} Analysis results
     */
    async analyzeImageQuality(imageBuffer) {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const stats = await sharp(imageBuffer).stats();

            const analysis = {
                needsEnhancement: false,
                reasons: [],
                metadata: {
                    width: metadata.width,
                    height: metadata.height,
                    format: metadata.format,
                    hasAlpha: metadata.hasAlpha
                },
                quality: {
                    brightness: this.calculateBrightness(stats),
                    contrast: this.calculateContrast(stats),
                    sharpness: null // Would need edge detection
                }
            };

            // Check if enhancement is needed
            if (analysis.quality.brightness < 0.3 || analysis.quality.brightness > 0.8) {
                analysis.needsEnhancement = true;
                analysis.reasons.push('brightness_issue');
            }

            if (analysis.quality.contrast < 0.3) {
                analysis.needsEnhancement = true;
                analysis.reasons.push('low_contrast');
            }

            if (metadata.width > 3000 || metadata.height > 3000) {
                analysis.needsEnhancement = true;
                analysis.reasons.push('oversized');
            }

            return analysis;

        } catch (error) {
            log.error('Error analyzing image quality', { error: error.message });
            return {
                needsEnhancement: true,
                reasons: ['analysis_failed']
            };
        }
    }

    /**
     * Calculate image brightness from stats
     * @param {Object} stats - Sharp stats object
     * @returns {number} Brightness value 0-1
     */
    calculateBrightness(stats) {
        const channels = stats.channels;
        let totalMean = 0;

        channels.forEach(channel => {
            totalMean += channel.mean;
        });

        return totalMean / (channels.length * 255);
    }

    /**
     * Calculate image contrast from stats
     * @param {Object} stats - Sharp stats object
     * @returns {number} Contrast value 0-1
     */
    calculateContrast(stats) {
        const channels = stats.channels;
        let totalStd = 0;

        channels.forEach(channel => {
            totalStd += channel.stdev;
        });

        return totalStd / (channels.length * 128);
    }

    /**
     * Save enhanced image to file
     * @param {Buffer} imageBuffer - Enhanced image
     * @param {string} outputPath - Output file path
     * @returns {Promise<void>}
     */
    async saveEnhancedImage(imageBuffer, outputPath) {
        try {
            await fs.writeFile(outputPath, imageBuffer);
            log.info('Enhanced image saved', { path: outputPath });
        } catch (error) {
            log.error('Error saving enhanced image', {
                path: outputPath,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Compare original and enhanced images
     * @param {Buffer} original - Original image
     * @param {Buffer} enhanced - Enhanced image
     * @returns {Promise<Object>} Comparison metrics
     */
    async compareImages(original, enhanced) {
        try {
            const [origMeta, enhMeta] = await Promise.all([
                sharp(original).metadata(),
                sharp(enhanced).metadata()
            ]);

            const [origStats, enhStats] = await Promise.all([
                sharp(original).stats(),
                sharp(enhanced).stats()
            ]);

            return {
                sizeReduction: {
                    bytes: origMeta.size - enhMeta.size,
                    percentage: ((origMeta.size - enhMeta.size) / origMeta.size * 100).toFixed(2)
                },
                dimensions: {
                    original: `${origMeta.width}x${origMeta.height}`,
                    enhanced: `${enhMeta.width}x${enhMeta.height}`
                },
                quality: {
                    brightnessChange: this.calculateBrightness(enhStats) - this.calculateBrightness(origStats),
                    contrastChange: this.calculateContrast(enhStats) - this.calculateContrast(origStats)
                }
            };

        } catch (error) {
            log.error('Error comparing images', { error: error.message });
            return null;
        }
    }
}

// Export singleton instance
const imageEnhancementService = new ImageEnhancementService();

export default imageEnhancementService;
export { ImageEnhancementService };