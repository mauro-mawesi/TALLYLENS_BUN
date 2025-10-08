import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
    getBudgets,
    getBudget,
    createBudget,
    updateBudget,
    deleteBudget,
    duplicateBudget,
    getBudgetProgress,
    getBudgetSpendingTrend,
    getBudgetsSummary,
    getBudgetInsights,
    getBudgetPredictions,
    getBudgetAlerts,
    markAlertAsRead,
    markAllAlertsAsRead,
    getAlertStats
} from '../controllers/budgetController.js';
import { authenticate } from '../middlewares/auth.js';
import { userApiLimiter } from '../middlewares/rateLimiter.js';
import { validate, sanitizeInput } from '../middlewares/validation.js';

const router = Router();

// Apply authentication, rate limiting and sanitization to all routes
router.use(authenticate);
router.use(userApiLimiter);  // User-specific rate limiting
router.use(sanitizeInput);

// Validation schemas
const budgetValidation = [
    body('name')
        .trim()
        .isLength({ min: 1, max: 255 })
        .withMessage('Name must be between 1 and 255 characters'),
    body('category')
        .optional()
        .isIn(['grocery', 'transport', 'food', 'fuel', 'others', null])
        .withMessage('Invalid category'),
    body('amount')
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('period')
        .isIn(['weekly', 'monthly', 'yearly', 'custom'])
        .withMessage('Period must be weekly, monthly, yearly, or custom'),
    body('startDate')
        .isISO8601()
        .withMessage('Start date must be a valid ISO 8601 date'),
    body('endDate')
        .isISO8601()
        .withMessage('End date must be a valid ISO 8601 date')
        .custom((value, { req }) => {
            if (new Date(value) <= new Date(req.body.startDate)) {
                throw new Error('End date must be after start date');
            }
            return true;
        }),
    body('currency')
        .optional()
        .isLength({ min: 3, max: 3 })
        .withMessage('Currency must be a 3-letter ISO code'),
    body('alertThresholds')
        .optional()
        .isArray()
        .withMessage('Alert thresholds must be an array')
        .custom((value) => {
            if (!value.every(t => typeof t === 'number' && t >= 0 && t <= 200)) {
                throw new Error('Alert thresholds must be numbers between 0 and 200');
            }
            return true;
        }),
    body('isRecurring')
        .optional()
        .isBoolean()
        .withMessage('isRecurring must be boolean'),
    body('allowRollover')
        .optional()
        .isBoolean()
        .withMessage('allowRollover must be boolean'),
    body('notificationChannels')
        .optional()
        .isObject()
        .withMessage('Notification channels must be an object')
];

const updateBudgetValidation = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 255 })
        .withMessage('Name must be between 1 and 255 characters'),
    body('category')
        .optional()
        .isIn(['grocery', 'transport', 'food', 'fuel', 'others', null])
        .withMessage('Invalid category'),
    body('amount')
        .optional()
        .isFloat({ min: 0.01 })
        .withMessage('Amount must be greater than 0'),
    body('period')
        .optional()
        .isIn(['weekly', 'monthly', 'yearly', 'custom'])
        .withMessage('Period must be weekly, monthly, yearly, or custom'),
    body('alertThresholds')
        .optional()
        .isArray()
        .withMessage('Alert thresholds must be an array'),
    body('isActive')
        .optional()
        .isBoolean()
        .withMessage('isActive must be boolean')
];

const duplicateBudgetValidation = [
    body('startDate')
        .optional()
        .isISO8601()
        .withMessage('Start date must be a valid ISO 8601 date'),
    body('endDate')
        .optional()
        .isISO8601()
        .withMessage('End date must be a valid ISO 8601 date')
];

const uuidValidation = [
    param('id')
        .isUUID()
        .withMessage('Invalid budget ID')
];

// Routes

/**
 * @swagger
 * /api/budgets:
 *   get:
 *     summary: Get all budgets for authenticated user
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [grocery, transport, food, fuel, others]
 *         description: Filter by category
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [weekly, monthly, yearly, custom]
 *         description: Filter by period
 *     responses:
 *       200:
 *         description: List of budgets
 */
router.get('/', getBudgets);

/**
 * @swagger
 * /api/budgets/summary:
 *   get:
 *     summary: Get summary of all user's budgets with progress
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Budget summary
 */
router.get('/summary', getBudgetsSummary);

/**
 * @swagger
 * /api/budgets/alerts:
 *   get:
 *     summary: Get budget alerts for user
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: boolean
 *         description: Return only unread alerts
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [threshold, predictive, comparative, digest, exceeded]
 *         description: Filter by alert type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of alerts to return
 *     responses:
 *       200:
 *         description: List of budget alerts
 */
router.get('/alerts', getBudgetAlerts);

/**
 * @swagger
 * /api/budgets/alerts/stats:
 *   get:
 *     summary: Get alert statistics
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to include in statistics
 *     responses:
 *       200:
 *         description: Alert statistics
 */
router.get('/alerts/stats', getAlertStats);

/**
 * @swagger
 * /api/budgets/alerts/mark-all-read:
 *   put:
 *     summary: Mark all alerts as read
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All alerts marked as read
 */
router.put('/alerts/mark-all-read', markAllAlertsAsRead);

/**
 * @swagger
 * /api/budgets/{id}:
 *   get:
 *     summary: Get specific budget by ID
 *     tags: [Budgets]
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
 *         description: Budget details
 *       404:
 *         description: Budget not found
 */
router.get('/:id', uuidValidation, validate, getBudget);

/**
 * @swagger
 * /api/budgets:
 *   post:
 *     summary: Create new budget
 *     tags: [Budgets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - amount
 *               - period
 *               - startDate
 *               - endDate
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Monthly Grocery Budget"
 *               category:
 *                 type: string
 *                 enum: [grocery, transport, food, fuel, others]
 *                 example: "grocery"
 *               amount:
 *                 type: number
 *                 example: 500.00
 *               period:
 *                 type: string
 *                 enum: [weekly, monthly, yearly, custom]
 *                 example: "monthly"
 *               startDate:
 *                 type: string
 *                 format: date
 *                 example: "2025-10-01"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 example: "2025-10-31"
 *               currency:
 *                 type: string
 *                 example: "USD"
 *               alertThresholds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [50, 75, 90, 100]
 *               isRecurring:
 *                 type: boolean
 *                 example: true
 *               allowRollover:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       201:
 *         description: Budget created successfully
 */
router.post('/', budgetValidation, validate, createBudget);

/**
 * @swagger
 * /api/budgets/{id}:
 *   put:
 *     summary: Update budget
 *     tags: [Budgets]
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
 *     responses:
 *       200:
 *         description: Budget updated successfully
 *       404:
 *         description: Budget not found
 */
router.put('/:id', [...uuidValidation, ...updateBudgetValidation], validate, updateBudget);

/**
 * @swagger
 * /api/budgets/{id}:
 *   delete:
 *     summary: Delete budget
 *     tags: [Budgets]
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
 *         description: Budget deleted successfully
 *       404:
 *         description: Budget not found
 */
router.delete('/:id', uuidValidation, validate, deleteBudget);

/**
 * @swagger
 * /api/budgets/{id}/duplicate:
 *   post:
 *     summary: Duplicate budget
 *     tags: [Budgets]
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Budget duplicated successfully
 */
router.post('/:id/duplicate', [...uuidValidation, ...duplicateBudgetValidation], validate, duplicateBudget);

/**
 * @swagger
 * /api/budgets/{id}/progress:
 *   get:
 *     summary: Get budget progress
 *     tags: [Budgets]
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
 *         description: Budget progress details
 */
router.get('/:id/progress', uuidValidation, validate, getBudgetProgress);

/**
 * @swagger
 * /api/budgets/{id}/spending-trend:
 *   get:
 *     summary: Get historical spending trend and projection for budget
 *     tags: [Budgets]
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
 *         description: Historical spending data with projection
 */
router.get('/:id/spending-trend', uuidValidation, validate, getBudgetSpendingTrend);

/**
 * @swagger
 * /api/budgets/{id}/insights:
 *   get:
 *     summary: Get AI-generated budget insights
 *     tags: [Budgets]
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
 *         description: Budget insights
 */
router.get('/:id/insights', uuidValidation, validate, getBudgetInsights);

/**
 * @swagger
 * /api/budgets/{id}/predictions:
 *   get:
 *     summary: Get budget exceedance predictions
 *     tags: [Budgets]
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
 *         description: Budget predictions
 */
router.get('/:id/predictions', uuidValidation, validate, getBudgetPredictions);

/**
 * @swagger
 * /api/budgets/alerts/{id}/read:
 *   put:
 *     summary: Mark alert as read
 *     tags: [Budgets]
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
 *         description: Alert marked as read
 */
router.put('/alerts/:id/read', uuidValidation, validate, markAlertAsRead);

export default router;
