import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { generalLimiter } from '../middlewares/rateLimiter.js';
import { languageDetectorAuth } from '../config/i18n.js';
import * as receiptsController from '../controllers/receiptsController.js';
import { validate } from '../middlewares/validation.js';
import { body, query, param } from 'express-validator';
import { ALL_VALID_CATEGORIES, mapCategoryParams } from '../utils/categoryMapper.js';

const router = express.Router();

// Apply rate limiting, authentication and language detection to all receipt routes
router.use(generalLimiter);
router.use(authenticate);
router.use(languageDetectorAuth);
router.use(mapCategoryParams);

/**
 * @swagger
 * /api/receipts:
 *   get:
 *     summary: Get user receipts with filtering
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Mercado, Transporte, Comida, Combustible, Otros]
 *       - in: query
 *         name: merchant
 *         schema:
 *           type: string
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: includeItems
 *         schema:
 *           type: boolean
 *           default: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Receipts retrieved successfully
 */
router.get('/', [
    query('category').optional().isIn(ALL_VALID_CATEGORIES),
    query('merchant').optional().isString().trim(),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
    query('minAmount').optional().isFloat({ min: 0 }),
    query('maxAmount').optional().isFloat({ min: 0 }),
    query('includeItems').optional().isBoolean(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('sortBy').optional().isIn(['purchaseDate', 'createdAt', 'amount', 'merchantName', 'category']),
    query('sortOrder').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
    validate
], receiptsController.getReceipts);

/**
 * @swagger
 * /api/receipts/{id}:
 *   get:
 *     summary: Get receipt by ID with items
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', [
    param('id').isUUID(),
    validate
], receiptsController.getReceiptById);

/**
 * @swagger
 * /api/receipts:
 *   post:
 *     summary: Create new receipt with OCR processing
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', [
    body('imageUrl').isURL().withMessage('imageUrl must be a valid URL'),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('category').optional().isIn(ALL_VALID_CATEGORIES),
    body('processedByMLKit').optional().isBoolean(),
    body('source').optional().isIn(['camera', 'gallery']),
    body('forceDuplicate').optional().isBoolean(),
    validate
], receiptsController.createReceipt);

/**
 * @swagger
 * /api/receipts/{id}:
 *   patch:
 *     summary: Update receipt
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:id', [
    param('id').isUUID(),
    body('category').optional().isIn(ALL_VALID_CATEGORIES),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('merchantName').optional().isString().isLength({ max: 255 }),
    body('purchaseDate').optional().isISO8601(),
    body('amount').optional().isFloat({ min: 0 }),
    validate
], receiptsController.updateReceipt);

/**
 * @swagger
 * /api/receipts/{id}:
 *   delete:
 *     summary: Delete receipt
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', [
    param('id').isUUID(),
    validate
], receiptsController.deleteReceipt);

/**
 * @swagger
 * /api/receipts/{id}/items:
 *   get:
 *     summary: Get receipt items
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/items', [
    param('id').isUUID(),
    validate
], receiptsController.getReceiptItems);

/**
 * @swagger
 * /api/receipts/{receiptId}/items/{itemId}:
 *   patch:
 *     summary: Update receipt item
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:receiptId/items/:itemId', [
    param('receiptId').isUUID(),
    param('itemId').isUUID(),
    body('quantity').optional().isFloat({ min: 0.001 }),
    body('unitPrice').optional().isFloat({ min: 0 }),
    body('isVerified').optional().isBoolean(),
    validate
], receiptsController.updateReceiptItem);

/**
 * @swagger
 * /api/receipts/stats:
 *   get:
 *     summary: Get receipt statistics
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/stats', [
    query('days').optional().isInt({ min: 1, max: 365 }),
    validate
], receiptsController.getReceiptStats);

export default router;
