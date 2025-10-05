import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { generalLimiter } from '../middlewares/rateLimiter.js';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { log } from '../utils/logger.js';
import Receipt from '../models/Receipt.js';

const router = express.Router();

// Apply rate limiting and authentication
router.use(generalLimiter);
router.use(authenticate);

/**
 * @swagger
 * /api/images/receipt/{receiptId}:
 *   get:
 *     summary: Get receipt image (original or thumbnail)
 *     tags: [Images]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: receiptId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: thumbnail
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Return thumbnail version
 *       - in: query
 *         name: width
 *         schema:
 *           type: integer
 *           minimum: 50
 *           maximum: 2000
 *         description: Resize width (only for thumbnail)
 *     responses:
 *       200:
 *         description: Image file
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Receipt or image not found
 */
router.get('/receipt/:receiptId', async (req, res) => {
    try {
        const { receiptId } = req.params;
        const { thumbnail, width = 300 } = req.query;
        const userId = req.user.id;

        // Verify receipt belongs to user
        const receipt = await Receipt.findOne({
            where: {
                id: receiptId,
                userId: userId
            }
        });

        if (!receipt) {
            return res.status(404).json({
                status: 'error',
                message: 'Receipt not found'
            });
        }

        // Extract filename from URL
        const imageUrl = receipt.imageUrl;
        if (!imageUrl) {
            return res.status(404).json({
                status: 'error',
                message: 'No image associated with this receipt'
            });
        }

        // Handle both relative paths and URLs
        let imagePath;

        // Check if it's a relative path (new structure: userId/receipts/filename)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
            // Relative path
            imagePath = path.resolve('uploads', imageUrl);
        } else if (imageUrl.includes('/uploads/')) {
            // Old URL format with /uploads/
            const filename = path.basename(imageUrl);
            imagePath = path.resolve('uploads', filename);
        } else {
            // External URL - not supported
            return res.status(400).json({
                status: 'error',
                message: 'External images not supported in this endpoint',
                imageUrl: imageUrl
            });
        }

        // Check if file exists
        try {
            await fs.access(imagePath);
        } catch {
            return res.status(404).json({
                status: 'error',
                message: 'Image file not found'
            });
        }

        // Return thumbnail if requested
        if (thumbnail === 'true' || thumbnail === true) {
            const thumbnailPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, `_thumb_${width}.$1`);

            // Check if thumbnail already exists
            let thumbnailExists = false;
            try {
                await fs.access(thumbnailPath);
                thumbnailExists = true;
            } catch {
                // Thumbnail doesn't exist, will create it
            }

            if (!thumbnailExists) {
                // Generate thumbnail
                try {
                    await sharp(imagePath)
                        .resize(parseInt(width), null, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 80 })
                        .toFile(thumbnailPath);

                    log.info('Thumbnail generated', {
                        original: imagePath,
                        thumbnail: thumbnailPath,
                        width: width
                    });
                } catch (error) {
                    log.error('Error generating thumbnail', {
                        error: error.message,
                        imagePath
                    });

                    // Fallback to original
                    return res.sendFile(imagePath);
                }
            }

            // Set cache headers for thumbnails
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
            return res.sendFile(thumbnailPath);
        }

        // Return original image with cache headers
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
        res.sendFile(imagePath);

    } catch (error) {
        log.error('Error serving receipt image', {
            error: error.message,
            receiptId: req.params.receiptId,
            userId: req.user.id
        });

        res.status(500).json({
            status: 'error',
            message: 'Error retrieving image'
        });
    }
});

/**
 * @swagger
 * /api/images/receipt/{receiptId}/info:
 *   get:
 *     summary: Get receipt image metadata
 *     tags: [Images]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: receiptId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Image metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 imageUrl:
 *                   type: string
 *                 thumbnailUrl:
 *                   type: string
 *                 hasImage:
 *                   type: boolean
 *                 imageType:
 *                   type: string
 *                   enum: [local, external]
 */
router.get('/receipt/:receiptId/info', async (req, res) => {
    try {
        const { receiptId } = req.params;
        const userId = req.user.id;

        const receipt = await Receipt.findOne({
            where: {
                id: receiptId,
                userId: userId
            },
            attributes: ['id', 'imageUrl', 'imageThumbnailUrl']
        });

        if (!receipt) {
            return res.status(404).json({
                status: 'error',
                message: 'Receipt not found'
            });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const imageUrl = receipt.imageUrl;

        // Check if it's a local file (relative path or /uploads/ URL)
        const isLocal = imageUrl && (
            !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') ||
            imageUrl.includes('/uploads/')
        );

        res.json({
            status: 'success',
            data: {
                imageUrl: imageUrl,
                thumbnailUrl: receipt.imageThumbnailUrl || `${baseUrl}/api/images/receipt/${receiptId}?thumbnail=true`,
                directImageUrl: null, // Always use protected endpoint
                hasImage: !!imageUrl,
                imageType: isLocal ? 'local' : 'external',
                endpoints: {
                    original: `${baseUrl}/api/images/receipt/${receiptId}`,
                    thumbnail: `${baseUrl}/api/images/receipt/${receiptId}?thumbnail=true`,
                    thumbnail_small: `${baseUrl}/api/images/receipt/${receiptId}?thumbnail=true&width=150`,
                    thumbnail_medium: `${baseUrl}/api/images/receipt/${receiptId}?thumbnail=true&width=300`,
                    thumbnail_large: `${baseUrl}/api/images/receipt/${receiptId}?thumbnail=true&width=600`
                }
            }
        });

    } catch (error) {
        log.error('Error getting image info', {
            error: error.message,
            receiptId: req.params.receiptId
        });

        res.status(500).json({
            status: 'error',
            message: 'Error retrieving image information'
        });
    }
});

export default router;