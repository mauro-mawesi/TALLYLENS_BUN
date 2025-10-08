import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { userApiLimiter } from '../middlewares/rateLimiter.js';
import { languageDetectorAuth } from '../config/i18n.js';
import * as receiptsController from '../controllers/receiptsController.js';
import * as syncController from '../controllers/syncController.js';
import { validate } from '../middlewares/validation.js';
import { body, query, param } from 'express-validator';
import { ALL_VALID_CATEGORIES, mapCategoryParams } from '../utils/categoryMapper.js';

const router = express.Router();

// Apply authentication, rate limiting and language detection to all receipt routes
router.use(authenticate);
router.use(userApiLimiter);  // User-specific rate limiting (more generous for authenticated users)
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
 * /api/receipts/sync:
 *   post:
 *     summary: Batch sync receipts (offline-first)
 *     tags: [Receipts, Sync]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - receipts
 *             properties:
 *               receipts:
 *                 type: array
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   properties:
 *                     localId:
 *                       type: string
 *                     serverId:
 *                       type: string
 *                     imageUrl:
 *                       type: string
 *                     merchantName:
 *                       type: string
 *                     category:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     purchaseDate:
 *                       type: string
 *                       format: date-time
 *                     notes:
 *                       type: string
 *                     processedByMLKit:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       200:
 *         description: Sync completed
 */
router.post('/sync', [
    body('receipts').isArray({ min: 1, max: 50 }).withMessage('receipts must be an array with 1-50 items'),
    validate
], syncController.syncReceipts);

/**
 * @swagger
 * /api/receipts/sync/status:
 *   get:
 *     summary: Get sync status
 *     tags: [Receipts, Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync status
 */
router.get('/sync/status', syncController.getSyncStatus);

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

/**
 * @swagger
 * /api/receipts/search:
 *   get:
 *     summary: Full-text search receipts
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (min 2 characters)
 *       - in: query
 *         name: category
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
 *         name: minAmount
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
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
 *         description: Search results with ranking
 */
router.get('/search', [
    query('q').notEmpty().isString().trim().isLength({ min: 2 }).withMessage('Search query must be at least 2 characters'),
    query('category').optional().isIn(ALL_VALID_CATEGORIES),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
    query('minAmount').optional().isFloat({ min: 0 }),
    query('maxAmount').optional().isFloat({ min: 0 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    validate
], receiptsController.searchReceipts);

/**
 * @swagger
 * /api/receipts/search/suggestions:
 *   get:
 *     summary: Get search suggestions
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Partial search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Search suggestions
 */
router.get('/search/suggestions', [
    query('q').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 20 }),
    validate
], receiptsController.getSearchSuggestions);

/**
 * @swagger
 * /api/receipts/search/history:
 *   get:
 *     summary: Get search history
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/search/history', [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn(['recent', 'popular']),
    validate
], receiptsController.getSearchHistory);

/**
 * @swagger
 * /api/receipts/search/history:
 *   delete:
 *     summary: Clear search history
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/search/history', receiptsController.clearSearchHistory);

/**
 * @swagger
 * /api/receipts/filters:
 *   get:
 *     summary: Get saved filters
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.get('/filters', [
    query('activeOnly').optional().isBoolean(),
    validate
], receiptsController.getSavedFilters);

/**
 * @swagger
 * /api/receipts/filters:
 *   post:
 *     summary: Create saved filter
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/filters', [
    body('name').notEmpty().isString().trim().isLength({ max: 255 }),
    body('description').optional().isString(),
    body('filters').notEmpty().isObject(),
    validate
], receiptsController.createSavedFilter);

/**
 * @swagger
 * /api/receipts/filters/{id}:
 *   patch:
 *     summary: Update saved filter
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/filters/:id', [
    param('id').isUUID(),
    body('name').optional().isString().trim().isLength({ max: 255 }),
    body('description').optional().isString(),
    body('filters').optional().isObject(),
    body('isActive').optional().isBoolean(),
    validate
], receiptsController.updateSavedFilter);

/**
 * @swagger
 * /api/receipts/filters/{id}:
 *   delete:
 *     summary: Delete saved filter
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/filters/:id', [
    param('id').isUUID(),
    validate
], receiptsController.deleteSavedFilter);

/**
 * @swagger
 * /api/receipts/filters/{id}/use:
 *   post:
 *     summary: Use saved filter (increment count)
 *     tags: [Receipts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/filters/:id/use', [
    param('id').isUUID(),
    validate
], receiptsController.useSavedFilter);

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

export default router;
