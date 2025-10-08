import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import Budget from '../models/Budget.js';
import BudgetAlert from '../models/BudgetAlert.js';
import Receipt from '../models/Receipt.js';
import { log } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Calculate current spending for a budget
 */
export async function calculateCurrentSpending(budgetId) {
    try {
        const budget = await Budget.findByPk(budgetId);
        if (!budget) {
            throw new NotFoundError('Budget not found');
        }

        const where = {
            userId: budget.userId,
            purchaseDate: {
                [Op.between]: [budget.startDate, budget.endDate]
            },
            amount: { [Op.not]: null }
        };

        // Filter by category if not global budget
        if (budget.category) {
            where.category = budget.category;
        }

        log.info(`Query conditions for budget ${budgetId}: ${JSON.stringify(where)}`);

        const result = await Receipt.findOne({
            where,
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'receiptCount'],
                [sequelize.fn('SUM', sequelize.col('amount')), 'totalSpending'],
                [sequelize.fn('AVG', sequelize.col('amount')), 'averageSpending']
            ],
            raw: true
        });

        log.info(`Query result for budget ${budgetId}: ${JSON.stringify(result)}`);
        const totalSpending = parseFloat(result.totalSpending) || 0;
        const totalBudget = budget.getTotalBudget();
        const percentage = totalBudget > 0 ? (totalSpending / totalBudget) * 100 : 0;

        return {
            budgetId: budget.id,
            budgetName: budget.name,
            totalBudget,
            currentSpending: totalSpending,
            remainingBudget: totalBudget - totalSpending,
            percentage: parseFloat(percentage.toFixed(2)),
            receiptCount: parseInt(result.receiptCount) || 0,
            averageSpending: parseFloat(result.averageSpending) || 0,
            daysRemaining: budget.daysRemaining(),
            daysElapsed: Math.max(0, Math.ceil((new Date() - new Date(budget.startDate)) / (1000 * 60 * 60 * 24))),
            isActive: budget.isActive,
            status: percentage >= 100 ? 'exceeded' : percentage >= 90 ? 'critical' : percentage >= 75 ? 'warning' : 'ok',
            startDate: budget.startDate,
            endDate: budget.endDate
        };
    } catch (error) {
        log.error(`Error calculating current spending for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Check and trigger budget alerts based on thresholds
 */
export async function checkBudgetAlerts(budgetId) {
    try {
        const budget = await Budget.findByPk(budgetId, {
            include: [{ model: BudgetAlert, as: 'alerts' }]
        });

        if (!budget || !budget.isActive) {
            return null;
        }

        const spending = await calculateCurrentSpending(budgetId);
        const currentPercentage = spending.percentage;
        const thresholds = budget.alertThresholds || [];

        // Find the highest threshold reached but not yet alerted
        const triggeredThresholds = thresholds.filter(t => currentPercentage >= t);

        if (triggeredThresholds.length === 0) {
            return null;
        }

        const highestTriggered = Math.max(...triggeredThresholds);

        // Check if we already sent alert for this threshold
        if (budget.lastAlertThreshold && budget.lastAlertThreshold >= highestTriggered) {
            return null; // Already alerted for this or higher threshold
        }

        // Check for recent duplicate alerts
        const isDuplicate = await BudgetAlert.wasSimilarAlertSentRecently(
            budgetId,
            'threshold',
            highestTriggered,
            24
        );

        if (isDuplicate) {
            return null;
        }

        // Create alert message
        let message = '';
        let alertType = 'threshold';

        if (highestTriggered >= 100) {
            alertType = 'exceeded';
            message = `Budget exceeded! You've spent ${spending.currentSpending.toFixed(2)} ${budget.currency} of your ${spending.totalBudget.toFixed(2)} ${budget.currency} budget (${currentPercentage.toFixed(0)}%)`;
        } else {
            message = `Budget alert: ${highestTriggered}% reached. You've spent ${spending.currentSpending.toFixed(2)} ${budget.currency} of your ${spending.totalBudget.toFixed(2)} ${budget.currency} budget`;
        }

        // Create the alert
        const alert = await BudgetAlert.create({
            budgetId: budget.id,
            userId: budget.userId,
            alertType,
            threshold: highestTriggered,
            currentSpending: spending.currentSpending,
            budgetAmount: spending.totalBudget,
            percentage: currentPercentage,
            message,
            sentVia: Object.keys(budget.notificationChannels).filter(ch => budget.notificationChannels[ch]),
            metadata: {
                daysRemaining: spending.daysRemaining,
                receiptCount: spending.receiptCount
            }
        });

        // Update budget's last alert tracking
        await budget.updateLastAlert(highestTriggered);

        log.info(`Budget alert created: ${alert.id} for budget ${budgetId} at ${highestTriggered}%`);

        return alert;
    } catch (error) {
        log.error(`Error checking budget alerts for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Predict if budget will be exceeded based on current spending rate
 */
export async function predictBudgetExceedance(budgetId) {
    try {
        const budget = await Budget.findByPk(budgetId);
        if (!budget) {
            throw new NotFoundError('Budget not found');
        }

        const spending = await calculateCurrentSpending(budgetId);
        const daysElapsed = Math.max(1, Math.ceil((new Date() - new Date(budget.startDate)) / (1000 * 60 * 60 * 24)));
        const dailySpendingRate = spending.currentSpending / daysElapsed;
        const daysRemaining = spending.daysRemaining;

        if (daysRemaining <= 0) {
            return {
                willExceed: spending.currentSpending > spending.totalBudget,
                daysUntilExceedance: 0,
                projectedSpending: spending.currentSpending,
                projectedOverage: Math.max(0, spending.currentSpending - spending.totalBudget),
                dailySpendingRate,
                recommendedDailyBudget: 0,
                confidence: 100
            };
        }

        const projectedSpending = spending.currentSpending + (dailySpendingRate * daysRemaining);
        const willExceed = projectedSpending > spending.totalBudget;

        let daysUntilExceedance = null;
        if (willExceed && dailySpendingRate > 0) {
            const remainingBudget = spending.totalBudget - spending.currentSpending;
            daysUntilExceedance = Math.ceil(remainingBudget / dailySpendingRate);
        }

        const recommendedDailyBudget = spending.remainingBudget / Math.max(1, daysRemaining);

        // Confidence based on data points (more receipts = higher confidence)
        const confidence = Math.min(100, (spending.receiptCount * 10));

        return {
            willExceed,
            daysUntilExceedance,
            projectedSpending: parseFloat(projectedSpending.toFixed(2)),
            projectedOverage: parseFloat(Math.max(0, projectedSpending - spending.totalBudget).toFixed(2)),
            dailySpendingRate: parseFloat(dailySpendingRate.toFixed(2)),
            recommendedDailyBudget: parseFloat(recommendedDailyBudget.toFixed(2)),
            confidence: Math.round(confidence),
            daysElapsed,
            daysRemaining
        };
    } catch (error) {
        log.error(`Error predicting budget exceedance for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Create predictive alert if budget will be exceeded
 */
export async function createPredictiveAlert(budgetId) {
    try {
        const prediction = await predictBudgetExceedance(budgetId);

        if (!prediction.willExceed || prediction.confidence < 50) {
            return null; // Don't alert if low confidence or won't exceed
        }

        const budget = await Budget.findByPk(budgetId);
        const spending = await calculateCurrentSpending(budgetId);

        // Check for duplicate predictive alerts
        const isDuplicate = await BudgetAlert.wasSimilarAlertSentRecently(
            budgetId,
            'predictive',
            null,
            48 // 48 hours for predictive alerts
        );

        if (isDuplicate) {
            return null;
        }

        const message = prediction.daysUntilExceedance ?
            `⚠️ Budget prediction: At your current spending rate (${prediction.dailySpendingRate.toFixed(2)} ${budget.currency}/day), you'll exceed your budget in ${prediction.daysUntilExceedance} days. Consider reducing daily spending to ${prediction.recommendedDailyBudget.toFixed(2)} ${budget.currency}.` :
            `⚠️ Budget prediction: You're likely to exceed your budget by ${prediction.projectedOverage.toFixed(2)} ${budget.currency}. Current rate: ${prediction.dailySpendingRate.toFixed(2)} ${budget.currency}/day.`;

        const alert = await BudgetAlert.create({
            budgetId: budget.id,
            userId: budget.userId,
            alertType: 'predictive',
            threshold: null,
            currentSpending: spending.currentSpending,
            budgetAmount: spending.totalBudget,
            percentage: spending.percentage,
            message,
            sentVia: Object.keys(budget.notificationChannels).filter(ch => budget.notificationChannels[ch]),
            metadata: {
                prediction,
                confidence: prediction.confidence
            }
        });

        log.info(`Predictive alert created: ${alert.id} for budget ${budgetId}`);

        return alert;
    } catch (error) {
        log.error(`Error creating predictive alert for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Generate insights and suggestions for a budget
 */
export async function generateBudgetInsights(budgetId) {
    try {
        const budget = await Budget.findByPk(budgetId);
        if (!budget) {
            throw new NotFoundError('Budget not found');
        }

        const spending = await calculateCurrentSpending(budgetId);
        const prediction = await predictBudgetExceedance(budgetId);
        const insights = [];

        // Insight 1: Spending pace
        if (spending.percentage > 80) {
            insights.push({
                type: 'warning',
                category: 'spending_pace',
                title: 'High spending detected',
                message: `You've used ${spending.percentage.toFixed(0)}% of your budget with ${spending.daysRemaining} days remaining.`,
                actionable: true,
                suggestion: `Reduce daily spending to ${prediction.recommendedDailyBudget.toFixed(2)} ${budget.currency} to stay within budget.`
            });
        } else if (spending.percentage < 40 && spending.daysRemaining < 5) {
            insights.push({
                type: 'positive',
                category: 'spending_pace',
                title: 'Great job!',
                message: `You're on track! Only ${spending.percentage.toFixed(0)}% of budget used.`,
                actionable: false
            });
        }

        // Insight 2: Comparison with previous period
        const previousPeriodSpending = await getPreviousPeriodSpending(budget);
        if (previousPeriodSpending) {
            const difference = spending.currentSpending - previousPeriodSpending.totalSpending;
            const percentChange = (difference / previousPeriodSpending.totalSpending) * 100;

            if (Math.abs(percentChange) > 20) {
                insights.push({
                    type: percentChange > 0 ? 'warning' : 'positive',
                    category: 'comparison',
                    title: percentChange > 0 ? 'Spending increased' : 'Spending decreased',
                    message: `You're spending ${Math.abs(percentChange).toFixed(0)}% ${percentChange > 0 ? 'more' : 'less'} than last period (${previousPeriodSpending.totalSpending.toFixed(2)} ${budget.currency}).`,
                    actionable: percentChange > 0,
                    suggestion: percentChange > 0 ? `Identify what changed and consider adjusting.` : null
                });
            }
        }

        // Insight 3: Rollover opportunity
        if (budget.allowRollover && spending.remainingBudget > 0 && spending.daysRemaining < 3) {
            insights.push({
                type: 'info',
                category: 'rollover',
                title: 'Rollover available',
                message: `You have ${spending.remainingBudget.toFixed(2)} ${budget.currency} remaining that will roll over to next period.`,
                actionable: false
            });
        }

        // Insight 4: Category-specific insights
        if (budget.category) {
            const categoryInsights = await getCategorySpecificInsights(budget, spending);
            insights.push(...categoryInsights);
        }

        return {
            budgetId: budget.id,
            insights,
            summary: {
                totalInsights: insights.length,
                warningCount: insights.filter(i => i.type === 'warning').length,
                positiveCount: insights.filter(i => i.type === 'positive').length,
                actionableCount: insights.filter(i => i.actionable).length
            }
        };
    } catch (error) {
        log.error(`Error generating insights for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Get previous period spending for comparison
 */
async function getPreviousPeriodSpending(budget) {
    try {
        const periodDays = Math.ceil((new Date(budget.endDate) - new Date(budget.startDate)) / (1000 * 60 * 60 * 24));
        const previousStartDate = new Date(budget.startDate);
        previousStartDate.setDate(previousStartDate.getDate() - periodDays);
        const previousEndDate = new Date(budget.startDate);
        previousEndDate.setDate(previousEndDate.getDate() - 1);

        const where = {
            userId: budget.userId,
            purchaseDate: {
                [Op.between]: [previousStartDate, previousEndDate]
            },
            amount: { [Op.not]: null }
        };

        if (budget.category) {
            where.category = budget.category;
        }

        const result = await Receipt.findOne({
            where,
            attributes: [
                [sequelize.fn('SUM', sequelize.col('amount')), 'totalSpending']
            ],
            raw: true
        });

        return result.totalSpending ? {
            totalSpending: parseFloat(result.totalSpending),
            startDate: previousStartDate,
            endDate: previousEndDate
        } : null;
    } catch (error) {
        log.error('Error getting previous period spending:', error);
        return null;
    }
}

/**
 * Get category-specific insights
 */
async function getCategorySpecificInsights(budget, spending) {
    const insights = [];

    // Get average spending for this category across all users (anonymized comparison)
    const avgCategorySpending = await Receipt.findOne({
        where: {
            category: budget.category,
            amount: { [Op.not]: null },
            purchaseDate: {
                [Op.between]: [budget.startDate, budget.endDate]
            }
        },
        attributes: [
            [sequelize.fn('AVG', sequelize.col('amount')), 'avgSpending']
        ],
        raw: true
    });

    if (avgCategorySpending && avgCategorySpending.avgSpending) {
        const avgSpending = parseFloat(avgCategorySpending.avgSpending);
        const userAvgSpending = spending.receiptCount > 0 ? spending.currentSpending / spending.receiptCount : 0;

        if (userAvgSpending > avgSpending * 1.5) {
            insights.push({
                type: 'info',
                category: 'benchmark',
                title: 'Above average spending',
                message: `Your average ${budget.category} purchase (${userAvgSpending.toFixed(2)} ${budget.currency}) is higher than typical users (${avgSpending.toFixed(2)} ${budget.currency}).`,
                actionable: true,
                suggestion: 'Look for ways to reduce per-transaction costs.'
            });
        }
    }

    return insights;
}

/**
 * Handle budget rollover at period end
 */
export async function handleBudgetRollover(budgetId) {
    try {
        const budget = await Budget.findByPk(budgetId);
        if (!budget || !budget.allowRollover || !budget.hasExpired()) {
            return null;
        }

        const spending = await calculateCurrentSpending(budgetId);

        if (spending.remainingBudget <= 0) {
            return { rolledOver: 0 };
        }

        // Deactivate current budget
        await budget.deactivate();

        // Create next period budget with rollover if recurring
        if (budget.isRecurring) {
            const nextBudget = await budget.createNextPeriod(spending.remainingBudget);
            log.info(`Budget rolled over: ${spending.remainingBudget.toFixed(2)} ${budget.currency} to budget ${nextBudget.id}`);

            return {
                rolledOver: spending.remainingBudget,
                nextBudgetId: nextBudget.id
            };
        }

        return { rolledOver: spending.remainingBudget };
    } catch (error) {
        log.error(`Error handling rollover for budget ${budgetId}:`, error);
        throw error;
    }
}

/**
 * Process all active budgets (for worker)
 */
export async function processActiveBudgets() {
    try {
        const activeBudgets = await Budget.findAll({
            where: {
                isActive: true,
                endDate: { [Op.gte]: new Date() }
            }
        });

        log.info(`Processing ${activeBudgets.length} active budgets...`);

        const results = {
            processed: 0,
            alertsCreated: 0,
            errors: 0
        };

        for (const budget of activeBudgets) {
            try {
                // Check threshold alerts
                const thresholdAlert = await checkBudgetAlerts(budget.id);
                if (thresholdAlert) results.alertsCreated++;

                // Check predictive alerts
                const predictiveAlert = await createPredictiveAlert(budget.id);
                if (predictiveAlert) results.alertsCreated++;

                results.processed++;
            } catch (error) {
                log.error(`Error processing budget ${budget.id}:`, error);
                results.errors++;
            }
        }

        log.info(`Budget processing complete: ${results.processed} processed, ${results.alertsCreated} alerts created, ${results.errors} errors`);

        return results;
    } catch (error) {
        log.error('Error in processActiveBudgets:', error);
        throw error;
    }
}

/**
 * Process expired recurring budgets
 */
export async function processExpiredRecurringBudgets() {
    try {
        const expiredBudgets = await Budget.findExpiredRecurring();

        log.info(`Processing ${expiredBudgets.length} expired recurring budgets...`);

        const results = {
            processed: 0,
            renewed: 0,
            errors: 0
        };

        for (const budget of expiredBudgets) {
            try {
                const rolloverResult = await handleBudgetRollover(budget.id);

                if (rolloverResult && rolloverResult.nextBudgetId) {
                    results.renewed++;
                }

                results.processed++;
            } catch (error) {
                log.error(`Error processing expired budget ${budget.id}:`, error);
                results.errors++;
            }
        }

        log.info(`Expired budgets processing complete: ${results.processed} processed, ${results.renewed} renewed, ${results.errors} errors`);

        return results;
    } catch (error) {
        log.error('Error in processExpiredRecurringBudgets:', error);
        throw error;
    }
}

/**
 * Get budget progress summary for user
 */
export async function getUserBudgetsSummary(userId) {
    try {
        const budgets = await Budget.findCurrentByUser(userId);

        const summaries = await Promise.all(
            budgets.map(async (budget) => {
                const spending = await calculateCurrentSpending(budget.id);
                const prediction = await predictBudgetExceedance(budget.id);

                return {
                    id: budget.id,
                    name: budget.name,
                    category: budget.category,
                    ...spending,
                    prediction: prediction.willExceed ? {
                        daysUntilExceedance: prediction.daysUntilExceedance,
                        projectedOverage: prediction.projectedOverage
                    } : null,
                    status: spending.percentage >= 100 ? 'exceeded' :
                            spending.percentage >= 90 ? 'critical' :
                            spending.percentage >= 75 ? 'warning' : 'ok'
                };
            })
        );

        return {
            userId,
            budgets: summaries,
            summary: {
                total: summaries.length,
                exceeded: summaries.filter(b => b.status === 'exceeded').length,
                critical: summaries.filter(b => b.status === 'critical').length,
                warning: summaries.filter(b => b.status === 'warning').length,
                ok: summaries.filter(b => b.status === 'ok').length
            }
        };
    } catch (error) {
        log.error(`Error getting budgets summary for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Get monthly spending trend with historical data and projection
 * Returns real historical spending + current month partial + projection
 */
export async function getMonthlySpendingTrend(budgetId, options = {}) {
    try {
        const budget = await Budget.findByPk(budgetId);
        if (!budget) {
            throw new NotFoundError('Budget not found');
        }

        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Options
        const months = Number.parseInt(options.months ?? 6, 10); // historical months
        const mode = (options.mode ?? 'cumulative').toString();  // 'cumulative' supported
        const sparse = !!(options.sparse ?? true);

        // Get last N months including current partial month
        // Start at the first day of (now - months)
        const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

        // Query receipts grouped by month
        const where = {
            userId: budget.userId,
            purchaseDate: {
                [Op.gte]: startDate,
                [Op.lte]: now
            },
            amount: { [Op.not]: null }
        };

        // Filter by category if not global budget
        if (budget.category) {
            where.category = budget.category;
        }

        const receipts = await Receipt.findAll({
            where,
            attributes: ['purchaseDate', 'amount'],
            raw: true,
            order: [['purchaseDate', 'ASC']]
        });

        // Group by month and calculate totals; also collect current month daily
        const monthlyData = {};
        const currentMonthDaily = {};
        receipts.forEach(receipt => {
            const date = new Date(receipt.purchaseDate);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                    month: monthKey,
                    total: 0,
                    count: 0,
                    isCurrentMonth: date >= currentMonthStart
                };
            }

            monthlyData[monthKey].total += parseFloat(receipt.amount);
            monthlyData[monthKey].count += 1;

            // If current month, build daily buckets
            if (date >= currentMonthStart) {
                const day = date.getDate();
                if (!currentMonthDaily[day]) {
                    currentMonthDaily[day] = 0;
                }
                currentMonthDaily[day] += parseFloat(receipt.amount);
            }
        });

        // Sort by month
        const sortedMonths = Object.values(monthlyData).sort((a, b) =>
            a.month.localeCompare(b.month)
        );

        // Calculate projection for current month
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const currentMonthData = monthlyData[currentMonthKey];

        let projection = null;
        if (currentMonthData) {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const daysElapsed = now.getDate();
            const dailyRate = currentMonthData.total / daysElapsed;
            const projectedTotal = dailyRate * daysInMonth;

            projection = {
                month: currentMonthKey,
                currentSpending: currentMonthData.total,
                daysElapsed,
                daysInMonth,
                dailyRate: parseFloat(dailyRate.toFixed(2)),
                projectedTotal: parseFloat(projectedTotal.toFixed(2)),
                willExceedBudget: projectedTotal > budget.amount,
                confidence: Math.min(95, Math.round((daysElapsed / daysInMonth) * 100))
            };
        }

        // Build current month daily cumulative series (if requested)
        let currentMonth = null;
        if (currentMonthData && mode === 'cumulative') {
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const dailyPoints = [];
            let cumulative = 0;
            for (let d = 1; d <= now.getDate(); d++) {
                const daySpending = currentMonthDaily[d] || 0;
                if (sparse && daySpending === 0) {
                    // skip no-receipt days
                    continue;
                }
                cumulative += daySpending;
                const dateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
                dailyPoints.push({ date: dateStr, cumulative: parseFloat(cumulative.toFixed(2)) });
            }
            currentMonth = { month: currentMonthKey, daysInMonth, dailyPoints };
        }

        // Historical months array (limit to the last N months BEFORE current month if desired)
        const historicalMonths = sortedMonths
            .filter(m => m.month !== currentMonthKey) // exclude current
            .slice(-months)
            .map(m => ({
                month: m.month,
                total: parseFloat(m.total.toFixed(2)),
                receiptCount: m.count
            }));

        return {
            budgetId: budget.id,
            budgetAmount: budget.amount,
            currency: budget.currency,
            category: budget.category || 'all',
            historicalData: sortedMonths.map(m => ({
                month: m.month,
                total: parseFloat(m.total.toFixed(2)),
                receiptCount: m.count,
                isCurrentMonth: m.isCurrentMonth
            })),
            historicalMonths,
            currentMonth,
            projection,
            period: {
                startDate,
                endDate: now
            }
        };
    } catch (error) {
        log.error(`Error getting monthly spending trend for budget ${budgetId}:`, error);
        throw error;
    }
}
