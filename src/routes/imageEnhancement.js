import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import {
    previewEnhancedImage,
    batchEnhanceImages,
    analyzeImageQuality,
    cleanupTempImages
} from '../controllers/imageEnhancementController.js';

const router = express.Router();

// Development-only warning middleware
router.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({
            status: 'error',
            message: 'Image enhancement endpoints are only available in development'
        });
    }
    next();
});

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/image-enhancement/preview
 * @desc    [DEV ONLY] Preview enhanced version of an image
 * @access  Private (Development only)
 */
router.post('/preview', previewEnhancedImage);

/**
 * @route   POST /api/image-enhancement/batch
 * @desc    [DEV ONLY] Enhance multiple images in batch
 * @access  Private (Development only)
 */
router.post('/batch', batchEnhanceImages);

/**
 * @route   POST /api/image-enhancement/analyze
 * @desc    [DEV ONLY] Analyze image quality and get recommendations
 * @access  Private (Development only)
 */
router.post('/analyze', analyzeImageQuality);

/**
 * @route   POST /api/image-enhancement/cleanup
 * @desc    [DEV ONLY] Clean up temporary enhanced images
 * @access  Private (Development only)
 */
router.post('/cleanup', cleanupTempImages);

export default router;