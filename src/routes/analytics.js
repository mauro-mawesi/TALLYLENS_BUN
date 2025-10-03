import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { generalLimiter } from '../middlewares/rateLimiter.js';
import { languageDetectorAuth } from '../config/i18n.js';
import * as analyticsController from '../controllers/analyticsController.js';
import { validate } from '../middlewares/validation.js';
import { param, query } from 'express-validator';

const router = express.Router();

// Apply rate limiting, authentication and language detection to all analytics routes
router.use(generalLimiter);
router.use(authenticate);
router.use(languageDetectorAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     MonthlyStats:
 *       type: object
 *       properties:
 *         month:
 *           type: string
 *           format: date
 *         purchaseCount:
 *           type: integer
 *         totalQuantity:
 *           type: number
 *         totalSpent:
 *           type: number
 *         avgPrice:
 *           type: number
 *         minPrice:
 *           type: number
 *         maxPrice:
 *           type: number
 *         merchantCount:
 *           type: integer
 *         priceVariation:
 *           type: string
 */

/**
 * @swagger
 * /api/analytics/products/{productId}/monthly-stats:
 *   get:
 *     summary: Get monthly purchase statistics for a product
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *           minimum: 1
 *           maximum: 24
 *     responses:
 *       200:
 *         description: Monthly statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     product:
 *                       $ref: '#/components/schemas/Product'
 *                     monthlyStats:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MonthlyStats'
 */
router.get('/products/:productId/monthly-stats', [
    param('productId')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),
    query('months')
        .optional()
        .isInt({ min: 1, max: 24 })
        .withMessage('Months must be between 1 and 24'),
    validate
], analyticsController.getProductMonthlyStats);

/**
 * @swagger
 * /api/analytics/products/{productId}/price-comparison:
 *   get:
 *     summary: Get price comparison across different merchants
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 90
 *           minimum: 30
 *           maximum: 365
 *     responses:
 *       200:
 *         description: Price comparison data retrieved successfully
 */
router.get('/products/:productId/price-comparison', [
    param('productId')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),
    query('days')
        .optional()
        .isInt({ min: 30, max: 365 })
        .withMessage('Days must be between 30 and 365'),
    validate
], analyticsController.getProductPriceComparison);

/**
 * @swagger
 * /api/analytics/products/{productId}/frequency-analysis:
 *   get:
 *     summary: Get purchase frequency analysis and predictions
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Frequency analysis retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     product:
 *                       $ref: '#/components/schemas/Product'
 *                     frequency:
 *                       type: object
 *                       properties:
 *                         purchaseCount:
 *                           type: integer
 *                         avgDaysBetween:
 *                           type: integer
 *                         lastPurchase:
 *                           type: string
 *                           format: date
 *                         daysSinceLastPurchase:
 *                           type: integer
 *                         nextPurchasePrediction:
 *                           type: string
 *                           format: date
 *                         consumptionRate:
 *                           type: number
 *                         isOverdue:
 *                           type: boolean
 *                         urgencyLevel:
 *                           type: string
 *                           enum: [low, medium, high]
 */
router.get('/products/:productId/frequency-analysis', [
    param('productId')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),
    validate
], analyticsController.getProductFrequencyAnalysis);

/**
 * @swagger
 * /api/analytics/spending-analysis:
 *   get:
 *     summary: Get comprehensive spending analysis by categories
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, year]
 *           default: month
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 6
 *           minimum: 1
 *           maximum: 24
 *     responses:
 *       200:
 *         description: Spending analysis retrieved successfully
 */
router.get('/spending-analysis', [
    query('period')
        .optional()
        .isIn(['week', 'month', 'year'])
        .withMessage('Period must be week, month, or year'),
    query('months')
        .optional()
        .isInt({ min: 1, max: 24 })
        .withMessage('Months must be between 1 and 24'),
    validate
], analyticsController.getSpendingAnalysis);

/**
 * @swagger
 * /api/analytics/monthly-totals:
 *   get:
 *     summary: Get total spending per month (aggregated)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 4
 *           minimum: 1
 *           maximum: 24
 *     responses:
 *       200:
 *         description: Monthly totals retrieved successfully
 */
router.get('/monthly-totals', [
    query('months')
        .optional()
        .isInt({ min: 1, max: 24 })
        .withMessage('Months must be between 1 and 24'),
    validate
], analyticsController.getMonthlyTotals);

/**
 * @swagger
 * /api/analytics/smart-alerts:
 *   get:
 *     summary: Get intelligent alerts and recommendations
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Smart alerts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     alertCount:
 *                       type: integer
 *                     alerts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             enum: [price_increase, running_low, budget_exceeded, savings_opportunity]
 *                           severity:
 *                             type: string
 *                             enum: [low, medium, high]
 *                           title:
 *                             type: string
 *                           message:
 *                             type: string
 *                           data:
 *                             type: object
 */
router.get('/smart-alerts', analyticsController.getSmartAlerts);

/**
 * @swagger
 * /api/analytics/recommendations:
 *   get:
 *     summary: Get product recommendations based on shopping patterns
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Product recommendations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     frequentlyBoughtTogether:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           productA:
 *                             type: string
 *                           productB:
 *                             type: string
 *                           frequency:
 *                             type: integer
 *                           recommendation:
 *                             type: string
 *                     seasonalTrends:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product:
 *                             type: string
 *                           category:
 *                             type: string
 *                           month:
 *                             type: integer
 *                           frequency:
 *                             type: integer
 *                           recommendation:
 *                             type: string
 */
router.get('/recommendations', analyticsController.getProductRecommendations);

export default router;
