import Budget from '../models/Budget.js';
import BudgetAlert from '../models/BudgetAlert.js';
import { asyncHandler } from '../utils/errors.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import * as budgetService from '../services/budgetService.js';
import cacheService from '../services/cacheService.js';

/**
 * GET /api/budgets
 * Get all budgets for authenticated user
 */
export const getBudgets = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { active, category, period } = req.query;

    const where = { userId };
    if (active !== undefined) {
        where.isActive = active === 'true';
    }
    if (category) {
        where.category = category;
    }
    if (period) {
        where.period = period;
    }

    const budgets = await Budget.findAll({
        where,
        order: [['createdAt', 'DESC']],
        include: [
            {
                model: BudgetAlert,
                as: 'alerts',
                separate: true,
                limit: 5,
                order: [['sentAt', 'DESC']]
            }
        ]
    });

    res.json({
        status: 'success',
        data: {
            budgets,
            count: budgets.length
        }
    });
});

/**
 * GET /api/budgets/:id
 * Get specific budget by ID
 */
export const getBudget = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const budget = await Budget.findOne({
        where: { id, userId },
        include: [
            {
                model: BudgetAlert,
                as: 'alerts',
                order: [['sentAt', 'DESC']],
                limit: 10
            }
        ]
    });

    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    res.json({
        status: 'success',
        data: { budget }
    });
});

/**
 * POST /api/budgets
 * Create new budget
 */
export const createBudget = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const budgetData = {
        ...req.body,
        userId
    };

    const budget = await Budget.create(budgetData);

    // Invalidate user budgets cache
    await cacheService.del(`budgets:user:${userId}`);
    await cacheService.del(`budgets:summary:${userId}`);

    log.info(`Budget created: ${budget.id} by user ${userId}`);

    res.status(201).json({
        status: 'success',
        message: req.t('budget.created_success'),
        data: { budget }
    });
});

/**
 * PUT /api/budgets/:id
 * Update budget
 */
export const updateBudget = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const budget = await Budget.findOne({ where: { id, userId } });

    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    // Don't allow changing userId
    delete updates.userId;

    await budget.update(updates);

    // Invalidate caches
    await cacheService.del(`budget:${id}`);
    await cacheService.del(`budgets:user:${userId}`);
    await cacheService.del(`budgets:summary:${userId}`);

    log.info(`Budget updated: ${id} by user ${userId}`);

    res.json({
        status: 'success',
        message: req.t('budget.updated_success'),
        data: { budget }
    });
});

/**
 * DELETE /api/budgets/:id
 * Delete budget
 */
export const deleteBudget = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const budget = await Budget.findOne({ where: { id, userId } });

    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    await budget.destroy();

    // Invalidate caches
    await cacheService.del(`budget:${id}`);
    await cacheService.del(`budgets:user:${userId}`);
    await cacheService.del(`budgets:summary:${userId}`);

    log.info(`Budget deleted: ${id} by user ${userId}`);

    res.json({
        status: 'success',
        message: req.t('budget.deleted_success')
    });
});

/**
 * POST /api/budgets/:id/duplicate
 * Duplicate budget
 */
export const duplicateBudget = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { startDate, endDate } = req.body;

    const newDates = {};
    if (startDate) newDates.startDate = startDate;
    if (endDate) newDates.endDate = endDate;

    const duplicatedBudget = await Budget.duplicate(id, userId, newDates);

    // Invalidate caches
    await cacheService.del(`budgets:user:${userId}`);
    await cacheService.del(`budgets:summary:${userId}`);

    log.info(`Budget duplicated: ${id} -> ${duplicatedBudget.id} by user ${userId}`);

    res.status(201).json({
        status: 'success',
        message: req.t('budget.duplicated_success'),
        data: { budget: duplicatedBudget }
    });
});

/**
 * GET /api/budgets/:id/progress
 * Get budget progress (spending, remaining, percentage)
 */
export const getBudgetProgress = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const budget = await Budget.findOne({ where: { id, userId } });
    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    // Check cache first
    const cacheKey = `budget:${id}:progress`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
        return res.json({
            status: 'success',
            data: cached,
            cached: true
        });
    }

    const progress = await budgetService.calculateCurrentSpending(id);

    // Cache for 5 minutes
    await cacheService.set(cacheKey, progress, 300);

    res.json({
        status: 'success',
        data: progress
    });
});

/**
 * GET /api/budgets/summary
 * Get summary of all user's budgets
 */
export const getBudgetsSummary = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Check cache first
    const cacheKey = `budgets:summary:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
        return res.json({
            status: 'success',
            data: cached,
            cached: true
        });
    }

    const summary = await budgetService.getUserBudgetsSummary(userId);

    // Cache for 10 minutes
    await cacheService.set(cacheKey, summary, 600);

    res.json({
        status: 'success',
        data: summary
    });
});

/**
 * GET /api/budgets/:id/insights
 * Get AI-generated insights for budget
 */
export const getBudgetInsights = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const budget = await Budget.findOne({ where: { id, userId } });
    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    // Check cache first
    const cacheKey = `budget:${id}:insights`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
        return res.json({
            status: 'success',
            data: cached,
            cached: true
        });
    }

    const insights = await budgetService.generateBudgetInsights(id);

    // Cache for 1 hour
    await cacheService.set(cacheKey, insights, 3600);

    res.json({
        status: 'success',
        data: insights
    });
});

/**
 * GET /api/budgets/:id/predictions
 * Get budget exceedance predictions
 */
export const getBudgetPredictions = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const budget = await Budget.findOne({ where: { id, userId } });
    if (!budget) {
        throw new NotFoundError('Budget not found');
    }

    // Check cache first
    const cacheKey = `budget:${id}:predictions`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
        return res.json({
            status: 'success',
            data: cached,
            cached: true
        });
    }

    const prediction = await budgetService.predictBudgetExceedance(id);

    // Cache for 30 minutes
    await cacheService.set(cacheKey, prediction, 1800);

    res.json({
        status: 'success',
        data: prediction
    });
});

/**
 * GET /api/budgets/alerts
 * Get budget alerts for user
 */
export const getBudgetAlerts = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { unreadOnly, type, limit = 50 } = req.query;

    const where = { userId };
    if (unreadOnly === 'true') {
        where.wasRead = false;
    }
    if (type) {
        where.alertType = type;
    }

    const alerts = await BudgetAlert.findAll({
        where,
        order: [['sentAt', 'DESC']],
        limit: parseInt(limit),
        include: [
            {
                model: Budget,
                as: 'budget',
                attributes: ['id', 'name', 'category', 'amount', 'currency']
            }
        ]
    });

    const unreadCount = await BudgetAlert.getUnreadCount(userId);

    res.json({
        status: 'success',
        data: {
            alerts,
            count: alerts.length,
            unreadCount
        }
    });
});

/**
 * PUT /api/budgets/alerts/:id/read
 * Mark alert as read
 */
export const markAlertAsRead = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const alert = await BudgetAlert.findOne({ where: { id, userId } });

    if (!alert) {
        throw new NotFoundError('Alert not found');
    }

    await alert.markAsRead();

    res.json({
        status: 'success',
        message: req.t('budget.alert_marked_read'),
        data: { alert }
    });
});

/**
 * PUT /api/budgets/alerts/mark-all-read
 * Mark all alerts as read
 */
export const markAllAlertsAsRead = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const result = await BudgetAlert.markAllAsReadByUser(userId);

    res.json({
        status: 'success',
        message: req.t('budget.all_alerts_marked_read'),
        data: {
            updated: result[0] // Number of rows updated
        }
    });
});

/**
 * GET /api/budgets/alerts/stats
 * Get alert statistics
 */
export const getAlertStats = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const stats = await BudgetAlert.getStatsByUser(userId, parseInt(days));

    res.json({
        status: 'success',
        data: stats
    });
});

export default {
    getBudgets,
    getBudget,
    createBudget,
    updateBudget,
    deleteBudget,
    duplicateBudget,
    getBudgetProgress,
    getBudgetsSummary,
    getBudgetInsights,
    getBudgetPredictions,
    getBudgetAlerts,
    markAlertAsRead,
    markAllAlertsAsRead,
    getAlertStats
};
