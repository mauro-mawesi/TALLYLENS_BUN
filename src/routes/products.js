import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { generalLimiter } from '../middlewares/rateLimiter.js';
import * as productController from '../controllers/productController.js';
import { validate } from '../middlewares/validation.js';
import { body, query, param } from 'express-validator';

const router = express.Router();

// Apply rate limiting and authentication to all product routes
router.use(generalLimiter);
router.use(authenticate);

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Product unique identifier
 *         name:
 *           type: string
 *           description: Product name
 *         normalizedName:
 *           type: string
 *           description: Normalized name for matching
 *         category:
 *           type: string
 *           enum: [Alimentos, Bebidas, Limpieza, Higiene, Farmacia, Otros]
 *         brand:
 *           type: string
 *           description: Product brand
 *         unit:
 *           type: string
 *           enum: [unidad, kg, g, l, ml, paquete, caja, botella]
 *         averagePrice:
 *           type: number
 *           format: decimal
 *         lowestPrice:
 *           type: number
 *           format: decimal
 *         highestPrice:
 *           type: number
 *           format: decimal
 *         lastSeenPrice:
 *           type: number
 *           format: decimal
 *         lastSeenAt:
 *           type: string
 *           format: date-time
 *         purchaseCount:
 *           type: integer
 *
 *     PriceHistory:
 *       type: object
 *       properties:
 *         product:
 *           $ref: '#/components/schemas/Product'
 *         priceHistory:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               price:
 *                 type: number
 *                 format: decimal
 *               date:
 *                 type: string
 *                 format: date-time
 *               merchant:
 *                 type: string
 *               quantity:
 *                 type: number
 *                 format: decimal
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get user's products with filters
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     products:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Product'
 *                     total:
 *                       type: integer
 */
router.get('/', [
    query('category').optional().isIn(['Alimentos', 'Bebidas', 'Limpieza', 'Higiene', 'Farmacia', 'Otros']),
    query('search').optional().isString().isLength({ min: 1, max: 100 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    validate
], productController.getProducts);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product details
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Product details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.get('/:id', [
    param('id').isUUID(),
    validate
], productController.getProduct);

/**
 * @swagger
 * /api/products/{id}/price-history:
 *   get:
 *     summary: Get product price history
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 90
 *     responses:
 *       200:
 *         description: Price history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/PriceHistory'
 */
router.get('/:id/price-history', [
    param('id').isUUID(),
    query('days').optional().isInt({ min: 1, max: 365 }),
    validate
], productController.getPriceHistory);

/**
 * @swagger
 * /api/products/analytics/top-products:
 *   get:
 *     summary: Get user's top purchased products
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 90
 *     responses:
 *       200:
 *         description: Top products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         $ref: '#/components/schemas/Product'
 *                       purchaseCount:
 *                         type: integer
 *                       totalQuantity:
 *                         type: number
 *                       totalSpent:
 *                         type: number
 *                       averagePrice:
 *                         type: number
 */
router.get('/analytics/top-products', [
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('days').optional().isInt({ min: 1, max: 365 }),
    validate
], productController.getTopProducts);

/**
 * @swagger
 * /api/products/analytics/price-alerts:
 *   get:
 *     summary: Get products with significant price changes
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           minimum: 0.1
 *           maximum: 1.0
 *           default: 0.2
 *         description: Price change threshold (0.2 = 20%)
 *     responses:
 *       200:
 *         description: Price alerts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         $ref: '#/components/schemas/Product'
 *                       priceChange:
 *                         type: number
 *                       changeType:
 *                         type: string
 *                         enum: [increase, decrease]
 */
router.get('/analytics/price-alerts', [
    query('threshold').optional().isFloat({ min: 0.1, max: 1.0 }),
    validate
], productController.getPriceAlerts);

/**
 * @swagger
 * /api/products/analytics/spending-by-category:
 *   get:
 *     summary: Get spending breakdown by product category
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 90
 *     responses:
 *       200:
 *         description: Spending by category retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       category:
 *                         type: string
 *                       totalSpent:
 *                         type: number
 *                       itemCount:
 *                         type: integer
 *                       averagePrice:
 *                         type: number
 */
router.get('/analytics/spending-by-category', [
    query('days').optional().isInt({ min: 1, max: 365 }),
    validate
], productController.getSpendingByCategory);

/**
 * @swagger
 * /api/products/{id}:
 *   patch:
 *     summary: Update product information
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *               category:
 *                 type: string
 *                 enum: [Alimentos, Bebidas, Limpieza, Higiene, Farmacia, Otros]
 *               brand:
 *                 type: string
 *                 maxLength: 100
 *               unit:
 *                 type: string
 *                 enum: [unidad, kg, g, l, ml, paquete, caja, botella]
 *               notes:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.patch('/:id', [
    param('id').isUUID(),
    body('name').optional().isString().isLength({ min: 1, max: 255 }),
    body('category').optional().isIn(['Alimentos', 'Bebidas', 'Limpieza', 'Higiene', 'Farmacia', 'Otros']),
    body('brand').optional().isString().isLength({ max: 100 }),
    body('unit').optional().isIn(['unidad', 'kg', 'g', 'l', 'ml', 'paquete', 'caja', 'botella']),
    body('notes').optional().isString().isLength({ max: 1000 }),
    validate
], productController.updateProduct);

export default router;