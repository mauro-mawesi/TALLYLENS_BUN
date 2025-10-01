import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import Product from '../models/Product.js';
import ReceiptItem from '../models/ReceiptItem.js';
import Receipt from '../models/Receipt.js';
import { Op, Sequelize } from 'sequelize';
import sequelize from '../config/db.js';
import { mapCategoryToLocalized } from '../utils/categoryMapper.js';
import { getUserPurchasePatterns, getPriceHistoryAnalysis } from '../services/analyticsService.js';

/**
 * Get monthly purchase statistics for a specific product
 */
export const getProductMonthlyStats = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { months = 12 } = req.query;
    const userId = req.user.id;

    // Verify user has access to this product
    const userHasProduct = await Receipt.findOne({
        where: { userId },
        include: [{
            model: ReceiptItem,
            as: 'items',
            where: { productId },
            attributes: ['id']
        }],
        attributes: ['id']
    });

    if (!userHasProduct) {
        return res.status(404).json({
            status: 'error',
            message: req.t('products.not_found')
        });
    }

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const monthlyStats = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                purchaseDate: {
                    [Op.gte]: startDate
                }
            },
            attributes: []
        }, {
            model: Product,
            as: 'product',
            where: { id: productId },
            attributes: []
        }],
        attributes: [
            [Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date')), 'month'],
            [Sequelize.fn('COUNT', '*'), 'purchaseCount'],
            [Sequelize.fn('SUM', Sequelize.col('quantity')), 'totalQuantity'],
            [Sequelize.fn('SUM', Sequelize.col('total_price')), 'totalSpent'],
            [Sequelize.fn('AVG', Sequelize.col('unit_price')), 'avgPrice'],
            [Sequelize.fn('MIN', Sequelize.col('unit_price')), 'minPrice'],
            [Sequelize.fn('MAX', Sequelize.col('unit_price')), 'maxPrice'],
            [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('receipt.merchant_name'))), 'merchantCount']
        ],
        group: [Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date'))],
        order: [[Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date')), 'ASC']],
        raw: true
    });

    const product = await Product.findByPk(productId);

    res.json({
        status: 'success',
        data: {
            product,
            monthlyStats: monthlyStats.map(stat => ({
                month: stat.month,
                purchaseCount: parseInt(stat.purchaseCount),
                totalQuantity: parseFloat(stat.totalQuantity),
                totalSpent: parseFloat(stat.totalSpent),
                avgPrice: parseFloat(stat.avgPrice),
                minPrice: parseFloat(stat.minPrice),
                maxPrice: parseFloat(stat.maxPrice),
                merchantCount: parseInt(stat.merchantCount),
                priceVariation: ((parseFloat(stat.maxPrice) - parseFloat(stat.minPrice)) / parseFloat(stat.minPrice) * 100).toFixed(2)
            }))
        }
    });
});

/**
 * Get product price comparison across different merchants
 */
export const getProductPriceComparison = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { days = 90 } = req.query;
    const userId = req.user.id;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const priceComparison = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                purchaseDate: {
                    [Op.gte]: startDate
                }
            },
            attributes: []
        }, {
            model: Product,
            as: 'product',
            where: { id: productId },
            attributes: []
        }],
        attributes: [
            [Sequelize.col('receipt.merchant_name'), 'merchant'],
            [Sequelize.fn('COUNT', '*'), 'purchaseCount'],
            [Sequelize.fn('AVG', Sequelize.col('unit_price')), 'avgPrice'],
            [Sequelize.fn('MIN', Sequelize.col('unit_price')), 'minPrice'],
            [Sequelize.fn('MAX', Sequelize.col('unit_price')), 'maxPrice'],
            [Sequelize.fn('SUM', Sequelize.col('total_price')), 'totalSpent']
        ],
        group: [Sequelize.col('receipt.merchant_name')],
        order: [[Sequelize.fn('AVG', Sequelize.col('unit_price')), 'ASC']],
        raw: true
    });

    const bestPrice = priceComparison.length > 0 ? parseFloat(priceComparison[0].avgPrice) : 0;

    res.json({
        status: 'success',
        data: {
            merchants: priceComparison.map(merchant => ({
                name: merchant.merchant,
                purchaseCount: parseInt(merchant.purchaseCount),
                avgPrice: parseFloat(merchant.avgPrice),
                minPrice: parseFloat(merchant.minPrice),
                maxPrice: parseFloat(merchant.maxPrice),
                totalSpent: parseFloat(merchant.totalSpent),
                savingsVsBest: bestPrice > 0 ? ((parseFloat(merchant.avgPrice) - bestPrice) / bestPrice * 100).toFixed(2) : 0,
                isBestPrice: parseFloat(merchant.avgPrice) === bestPrice
            }))
        }
    });
});

/**
 * Get product purchase frequency analysis and predictions
 */
export const getProductFrequencyAnalysis = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const userId = req.user.id;

    // Get all purchases for this product
    const purchases = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: { userId },
            attributes: ['purchaseDate']
        }, {
            model: Product,
            as: 'product',
            where: { id: productId },
            attributes: ['name', 'category']
        }],
        attributes: ['quantity', 'totalPrice', 'createdAt'],
        order: [['createdAt', 'ASC']]
    });

    if (purchases.length < 2) {
        return res.json({
            status: 'success',
            data: {
                message: req.t('analytics.insufficient_data'),
                purchaseCount: purchases.length
            }
        });
    }

    // Calculate frequency statistics
    const dates = purchases.map(p => new Date(p.receipt.purchaseDate));
    const intervals = [];

    for (let i = 1; i < dates.length; i++) {
        const daysDiff = Math.floor((dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24));
        intervals.push(daysDiff);
    }

    const avgDaysBetween = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const lastPurchase = dates[dates.length - 1];
    const daysSinceLastPurchase = Math.floor((new Date() - lastPurchase) / (1000 * 60 * 60 * 24));

    // Enhanced purchase patterns analysis
    const result = await getUserPurchasePatterns(userId, {
        days: 180,
        includeProductAnalysis: true,
        includeMerchantAnalysis: true,
        includePaymentAnalysis: true
    });

    // Price history analysis
    const priceHistory = await getPriceHistoryAnalysis(productId, 180);

    // Predict next purchase
    const nextPurchasePrediction = new Date(lastPurchase);
    nextPurchasePrediction.setDate(nextPurchasePrediction.getDate() + Math.round(avgDaysBetween));

    // Calculate consumption rate
    const totalQuantity = purchases.reduce((sum, p) => sum + parseFloat(p.quantity), 0);
    const totalDays = Math.floor((dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24));
    const consumptionRate = totalDays > 0 ? totalQuantity / totalDays : 0;

    res.json({
        status: 'success',
        data: {
            product: purchases[0].product,
            frequency: {
                purchaseCount: purchases.length,
                avgDaysBetween: Math.round(avgDaysBetween),
                lastPurchase: lastPurchase.toISOString().split('T')[0],
                daysSinceLastPurchase,
                nextPurchasePrediction: nextPurchasePrediction.toISOString().split('T')[0],
                consumptionRate: parseFloat(consumptionRate.toFixed(4)),
                isOverdue: daysSinceLastPurchase > avgDaysBetween * 1.2,
                urgencyLevel: daysSinceLastPurchase > avgDaysBetween * 1.5 ? 'high' :
                             daysSinceLastPurchase > avgDaysBetween ? 'medium' : 'low'
            },
            statistics: {
                totalSpent: purchases.reduce((sum, p) => sum + parseFloat(p.totalPrice), 0),
                avgQuantityPerPurchase: totalQuantity / purchases.length,
                shortestInterval: Math.min(...intervals),
                longestInterval: Math.max(...intervals)
            },
            purchasePatterns: result.success ? result.data : null,
            priceHistory: priceHistory.success ? priceHistory.data : null
        }
    });
});

/**
 * Get comprehensive spending analysis by categories
 */
export const getSpendingAnalysis = asyncHandler(async (req, res) => {
    const { period = 'month', months = 6 } = req.query;
    const userId = req.user.id;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    // Get spending by category
    const categorySpending = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                purchaseDate: {
                    [Op.gte]: startDate
                }
            },
            attributes: []
        }, {
            model: Product,
            as: 'product',
            attributes: ['category']
        }],
        attributes: [
            [Sequelize.col('product.category'), 'category'],
            [Sequelize.fn('SUM', Sequelize.col('total_price')), 'totalSpent'],
            [Sequelize.fn('COUNT', '*'), 'itemCount'],
            [Sequelize.fn('AVG', Sequelize.col('total_price')), 'avgItemPrice'],
            [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('product_id'))), 'uniqueProducts']
        ],
        group: ['product.category'],
        order: [[Sequelize.fn('SUM', Sequelize.col('total_price')), 'DESC']],
        raw: true
    });

    const totalSpent = categorySpending.reduce((sum, cat) => sum + parseFloat(cat.totalSpent), 0);

    // Get monthly trends
    const monthlyTrends = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                purchaseDate: {
                    [Op.gte]: startDate
                }
            },
            attributes: []
        }, {
            model: Product,
            as: 'product',
            attributes: []
        }],
        attributes: [
            [Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date')), 'month'],
            [Sequelize.col('product.category'), 'category'],
            [Sequelize.fn('SUM', Sequelize.col('total_price')), 'monthlySpent']
        ],
        group: [
            Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date')),
            'product.category'
        ],
        order: [
            [Sequelize.fn('DATE_TRUNC', 'month', Sequelize.col('receipt.purchase_date')), 'ASC']
        ],
        raw: true
    });

    res.json({
        status: 'success',
        data: {
            period: `${months} months`,
            totalSpent,
            categories: categorySpending.map(cat => ({
                category: cat.category ? mapCategoryToLocalized(cat.category, req.user.preferredLanguage || 'en') : req.t('categories.uncategorized'),
                totalSpent: parseFloat(cat.totalSpent),
                percentage: ((parseFloat(cat.totalSpent) / totalSpent) * 100).toFixed(2),
                itemCount: parseInt(cat.itemCount),
                avgItemPrice: parseFloat(cat.avgItemPrice),
                uniqueProducts: parseInt(cat.uniqueProducts)
            })),
            monthlyTrends: monthlyTrends.map(trend => ({
                month: trend.month,
                category: trend.category ? mapCategoryToLocalized(trend.category, req.user.preferredLanguage || 'en') : req.t('categories.uncategorized'),
                spent: parseFloat(trend.monthlySpent)
            }))
        }
    });
});

/**
 * Get intelligent alerts and recommendations
 */
export const getSmartAlerts = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const alerts = [];

    // Price spike alerts (products that have increased significantly)
    const priceSpikes = await sequelize.query(`
        WITH recent_prices AS (
            SELECT
                p.id, p.name, p.category,
                AVG(ri.unit_price) as recent_avg,
                (SELECT AVG(ri2.unit_price)
                 FROM receipt_items ri2
                 JOIN receipts r2 ON ri2.receipt_id = r2.id
                 WHERE ri2.product_id = p.id AND r2.user_id = :userId
                 AND r2.purchase_date < (CURRENT_DATE - INTERVAL '30 days')
                ) as historical_avg
            FROM products p
            JOIN receipt_items ri ON p.id = ri.product_id
            JOIN receipts r ON ri.receipt_id = r.id
            WHERE r.user_id = :userId
            AND r.purchase_date >= (CURRENT_DATE - INTERVAL '30 days')
            GROUP BY p.id, p.name, p.category
        )
        SELECT * FROM recent_prices
        WHERE historical_avg IS NOT NULL
        AND recent_avg > historical_avg * 1.2
        ORDER BY (recent_avg - historical_avg) / historical_avg DESC
        LIMIT 5
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    priceSpikes.forEach(spike => {
        alerts.push({
            type: 'price_increase',
            severity: 'medium',
            title: req.t('alerts.price_increase_title'),
            message: req.t('alerts.price_increase_message', {
                product: spike.name,
                increase: Math.round(((spike.recent_avg - spike.historical_avg) / spike.historical_avg) * 100)
            }),
            data: spike
        });
    });

    // Products running low (simplified approach)
    const runningLow = await sequelize.query(`
        WITH product_purchases AS (
            SELECT
                p.id, p.name, p.category,
                COUNT(*) as purchase_count,
                MAX(r.purchase_date) as last_purchase,
                EXTRACT(days FROM (CURRENT_DATE - MAX(r.purchase_date))) as days_since_last
            FROM products p
            JOIN receipt_items ri ON p.id = ri.product_id
            JOIN receipts r ON ri.receipt_id = r.id
            WHERE r.user_id = :userId
            GROUP BY p.id, p.name, p.category
            HAVING COUNT(*) >= 3
        )
        SELECT *,
               CASE
                   WHEN days_since_last > 30 THEN 30
                   WHEN days_since_last > 14 THEN 14
                   ELSE 7
               END as estimated_frequency
        FROM product_purchases
        WHERE days_since_last >
               CASE
                   WHEN purchase_count >= 10 THEN 14
                   WHEN purchase_count >= 5 THEN 21
                   ELSE 30
               END
        ORDER BY days_since_last DESC
        LIMIT 5
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    runningLow.forEach(product => {
        alerts.push({
            type: 'running_low',
            severity: product.days_since_last > 30 ? 'high' : 'medium',
            title: req.t('alerts.running_low_title'),
            message: req.t('alerts.running_low_message', {
                product: product.name,
                days: Math.round(product.days_since_last)
            }),
            data: product
        });
    });

    // Budget alerts (categories spending more than usual)
    const budgetAlerts = await sequelize.query(`
        WITH current_month_spending AS (
            SELECT
                p.category,
                SUM(ri.total_price) as current_month_total
            FROM receipt_items ri
            JOIN receipts r ON ri.receipt_id = r.id
            JOIN products p ON ri.product_id = p.id
            WHERE r.user_id = :userId
            AND DATE_TRUNC('month', r.purchase_date) = DATE_TRUNC('month', CURRENT_DATE)
            GROUP BY p.category
        ),
        historical_averages AS (
            SELECT
                monthly_totals.category,
                AVG(monthly_totals.monthly_total) as avg_monthly
            FROM (
                SELECT
                    p.category,
                    DATE_TRUNC('month', r.purchase_date) as month,
                    SUM(ri.total_price) as monthly_total
                FROM receipt_items ri
                JOIN receipts r ON ri.receipt_id = r.id
                JOIN products p ON ri.product_id = p.id
                WHERE r.user_id = :userId
                AND r.purchase_date >= (CURRENT_DATE - INTERVAL '6 months')
                AND DATE_TRUNC('month', r.purchase_date) != DATE_TRUNC('month', CURRENT_DATE)
                GROUP BY p.category, DATE_TRUNC('month', r.purchase_date)
            ) monthly_totals
            GROUP BY monthly_totals.category
        )
        SELECT
            c.category,
            c.current_month_total as current_month,
            h.avg_monthly
        FROM current_month_spending c
        JOIN historical_averages h ON c.category = h.category
        WHERE c.current_month_total > h.avg_monthly * 1.3
        ORDER BY (c.current_month_total - h.avg_monthly) / h.avg_monthly DESC
        LIMIT 3
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    budgetAlerts.forEach(budget => {
        alerts.push({
            type: 'budget_exceeded',
            severity: 'high',
            title: req.t('alerts.budget_exceeded_title'),
            message: req.t('alerts.budget_exceeded_message', {
                category: mapCategoryToLocalized(budget.category, req.user.preferredLanguage || 'en'),
                increase: Math.round(((budget.current_month - budget.avg_monthly) / budget.avg_monthly) * 100)
            }),
            data: budget
        });
    });

    // Savings opportunities (simplified approach)
    const savingsOpportunities = await sequelize.query(`
        WITH merchant_prices AS (
            SELECT
                p.id, p.name,
                r.merchant_name,
                AVG(ri.unit_price) as merchant_avg,
                COUNT(*) as purchase_count
            FROM products p
            JOIN receipt_items ri ON p.id = ri.product_id
            JOIN receipts r ON ri.receipt_id = r.id
            WHERE r.user_id = :userId
            AND r.purchase_date >= (CURRENT_DATE - INTERVAL '90 days')
            GROUP BY p.id, p.name, r.merchant_name
            HAVING COUNT(*) >= 2
        ),
        product_overall_avg AS (
            SELECT
                p.id,
                AVG(ri.unit_price) as overall_avg
            FROM products p
            JOIN receipt_items ri ON p.id = ri.product_id
            JOIN receipts r ON ri.receipt_id = r.id
            WHERE r.user_id = :userId
            GROUP BY p.id
        )
        SELECT
            mp.id, mp.name, mp.merchant_name,
            mp.merchant_avg, poa.overall_avg
        FROM merchant_prices mp
        JOIN product_overall_avg poa ON mp.id = poa.id
        WHERE mp.merchant_avg > poa.overall_avg * 1.15
        ORDER BY (mp.merchant_avg - poa.overall_avg) / poa.overall_avg DESC
        LIMIT 3
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    savingsOpportunities.forEach(saving => {
        alerts.push({
            type: 'savings_opportunity',
            severity: 'low',
            title: req.t('alerts.savings_opportunity_title'),
            message: req.t('alerts.savings_opportunity_message', {
                product: saving.name,
                merchant: saving.merchant_name,
                savings: Math.round(((saving.merchant_avg - saving.overall_avg) / saving.overall_avg) * 100)
            }),
            data: saving
        });
    });

    // Enhanced pattern analysis using new service
    const purchasePatterns = await getUserPurchasePatterns(userId, {
        days: 90,
        includeProductAnalysis: true,
        includeMerchantAnalysis: true,
        includePaymentAnalysis: true
    });

    if (purchasePatterns.success) {
        // Add VAT optimization alerts
        if (purchasePatterns.data.vatAnalysis?.length > 0) {
            purchasePatterns.data.vatAnalysis.forEach(vat => {
                if (vat.receipt_count > 5 && vat.avg_vat_21 > 0) {
                    alerts.push({
                        type: 'vat_analysis',
                        severity: 'info',
                        title: 'VAT Analysis',
                        message: `Average 21% VAT in ${vat.country}: ${parseFloat(vat.avg_vat_21 || 0).toFixed(2)}`,
                        data: vat
                    });
                }
            });
        }

        // Add discount utilization alerts
        if (purchasePatterns.data.discountAnalysis?.length > 0) {
            const totalSavings = purchasePatterns.data.discountAnalysis.reduce((total, item) =>
                total + parseFloat(item.dataValues?.totalSavings || 0), 0);

            if (totalSavings > 10) {
                alerts.push({
                    type: 'discount_success',
                    severity: 'info',
                    title: 'Discount Savings',
                    message: `Total discount savings: ${totalSavings.toFixed(2)}`,
                    data: { totalSavings }
                });
            }
        }
    }

    res.json({
        status: 'success',
        data: {
            alertCount: alerts.length,
            alerts: alerts.sort((a, b) => {
                const severityOrder = { high: 3, medium: 2, low: 1 };
                return severityOrder[b.severity] - severityOrder[a.severity];
            }),
            enhancedPatterns: purchasePatterns.success ? purchasePatterns.data : null
        }
    });
});

/**
 * Get product recommendations based on shopping patterns
 */
export const getProductRecommendations = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Get frequently bought together products
    const frequentlyBoughtTogether = await sequelize.query(`
        WITH product_pairs AS (
            SELECT
                ri1.product_id as product_a,
                ri2.product_id as product_b,
                COUNT(*) as frequency
            FROM receipt_items ri1
            JOIN receipt_items ri2 ON ri1.receipt_id = ri2.receipt_id
            JOIN receipts r ON ri1.receipt_id = r.id
            WHERE r.user_id = :userId
            AND ri1.product_id < ri2.product_id
            GROUP BY ri1.product_id, ri2.product_id
            HAVING COUNT(*) >= 2
        )
        SELECT
            p1.name as product_a_name,
            p2.name as product_b_name,
            pp.frequency
        FROM product_pairs pp
        JOIN products p1 ON pp.product_a = p1.id
        JOIN products p2 ON pp.product_b = p2.id
        ORDER BY pp.frequency DESC
        LIMIT 10
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    // Get seasonal recommendations based on purchase patterns
    const seasonalTrends = await sequelize.query(`
        SELECT
            p.id, p.name, p.category,
            EXTRACT(month FROM r.purchase_date) as month,
            COUNT(*) as purchase_frequency
        FROM products p
        JOIN receipt_items ri ON p.id = ri.product_id
        JOIN receipts r ON ri.receipt_id = r.id
        WHERE r.user_id = :userId
        AND r.purchase_date >= (CURRENT_DATE - INTERVAL '2 years')
        GROUP BY p.id, p.name, p.category, EXTRACT(month FROM r.purchase_date)
        HAVING COUNT(*) >= 2
        ORDER BY purchase_frequency DESC
        LIMIT 15
    `, {
        replacements: { userId },
        type: Sequelize.QueryTypes.SELECT
    });

    res.json({
        status: 'success',
        data: {
            frequentlyBoughtTogether: frequentlyBoughtTogether.map(pair => ({
                productA: pair.product_a_name,
                productB: pair.product_b_name,
                frequency: parseInt(pair.frequency),
                recommendation: req.t('recommendations.frequently_bought_together', {
                    productA: pair.product_a_name,
                    productB: pair.product_b_name
                })
            })),
            seasonalTrends: seasonalTrends.map(trend => ({
                product: trend.name,
                category: mapCategoryToLocalized(trend.category, req.user.preferredLanguage || 'en'),
                month: parseInt(trend.month),
                frequency: parseInt(trend.purchase_frequency),
                recommendation: req.t('recommendations.seasonal_trend', {
                    product: trend.name,
                    month: new Date(2024, trend.month - 1).toLocaleString('default', { month: 'long' })
                })
            }))
        }
    });
});