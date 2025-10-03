import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import Receipt from '../models/Receipt.js';
import Product from '../models/Product.js';
import ReceiptItem from '../models/ReceiptItem.js';
import { log } from '../utils/logger.js';

export async function getUserPurchasePatterns(userId, options = {}) {
    const {
        days = 90,
        includeProductAnalysis = true,
        includeMerchantAnalysis = true,
        includePaymentAnalysis = true
    } = options;

    const dateFrom = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    try {
        const patterns = {};

        // 1. Spending patterns by category
        const categorySpending = await Receipt.findAll({
            where: {
                userId,
                createdAt: { [Op.gte]: dateFrom },
                amount: { [Op.not]: null }
            },
            attributes: [
                'category',
                [sequelize.fn('COUNT', sequelize.col('id')), 'receiptCount'],
                [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
                [sequelize.fn('AVG', sequelize.col('amount')), 'averageAmount'],
                [sequelize.fn('MIN', sequelize.col('amount')), 'minAmount'],
                [sequelize.fn('MAX', sequelize.col('amount')), 'maxAmount']
            ],
            group: ['category'],
            // Order by the alias defined above ('totalAmount')
            order: [[sequelize.col('totalAmount'), 'DESC']]
        });

        patterns.categorySpending = categorySpending;

        // 2. Weekly spending trends
        const weeklyTrends = await sequelize.query(`
            SELECT
                DATE_TRUNC('week', created_at) as week,
                COUNT(*) as receipt_count,
                SUM(amount) as total_amount,
                AVG(amount) as average_amount
            FROM receipts
            WHERE user_id = :userId
                AND created_at >= :dateFrom
                AND amount IS NOT NULL
            GROUP BY DATE_TRUNC('week', created_at)
            ORDER BY week DESC
        `, {
            replacements: { userId, dateFrom },
            type: sequelize.QueryTypes.SELECT
        });

        patterns.weeklyTrends = weeklyTrends;

        // 3. Monthly comparison
        const monthlyComparison = await sequelize.query(`
            SELECT
                DATE_TRUNC('month', created_at) as month,
                category,
                COUNT(*) as receipt_count,
                SUM(amount) as total_amount
            FROM receipts
            WHERE user_id = :userId
                AND created_at >= :dateFrom
                AND amount IS NOT NULL
            GROUP BY DATE_TRUNC('month', created_at), category
            ORDER BY month DESC, total_amount DESC
        `, {
            replacements: { userId, dateFrom },
            type: sequelize.QueryTypes.SELECT
        });

        patterns.monthlyComparison = monthlyComparison;

        // 4. Most frequent merchants
        if (includeMerchantAnalysis) {
            const merchantFrequency = await Receipt.findAll({
                where: {
                    userId,
                    createdAt: { [Op.gte]: dateFrom },
                    merchantName: { [Op.not]: null }
                },
                attributes: [
                    'merchantName',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'visitCount'],
                    [sequelize.fn('SUM', sequelize.col('amount')), 'totalSpent'],
                    [sequelize.fn('AVG', sequelize.col('amount')), 'averageSpent'],
                    [sequelize.fn('MAX', sequelize.col('created_at')), 'lastVisit']
                ],
                group: ['merchantName'],
                having: sequelize.where(sequelize.fn('COUNT', sequelize.col('id')), '>=', 2),
                // Order by the alias defined above ('visitCount')
                order: [[sequelize.col('visitCount'), 'DESC']],
                limit: 15
            });

            patterns.merchantFrequency = merchantFrequency;
        }

        // 5. Payment method preferences
        if (includePaymentAnalysis) {
            const paymentMethods = await Receipt.findAll({
                where: {
                    userId,
                    createdAt: { [Op.gte]: dateFrom },
                    paymentMethod: { [Op.not]: null }
                },
                attributes: [
                    'paymentMethod',
                    'cardType',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'usageCount'],
                    [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
                    [sequelize.fn('AVG', sequelize.col('amount')), 'averageAmount']
                ],
                group: ['paymentMethod', 'cardType'],
                order: [[sequelize.col('usageCount'), 'DESC']]
            });

            patterns.paymentMethods = paymentMethods;
        }

        // 6. Most purchased products
        if (includeProductAnalysis) {
            const topProducts = await sequelize.query(`
                SELECT
                    p.name,
                    p.normalized_name,
                    p.category,
                    p.brand,
                    COUNT(ri.id) as purchase_count,
                    SUM(ri.quantity) as total_quantity,
                    SUM(ri.total_price) as total_spent,
                    AVG(ri.unit_price) as average_price,
                    MAX(r.created_at) as last_purchased
                FROM products p
                JOIN receipt_items ri ON p.id = ri.product_id
                JOIN receipts r ON ri.receipt_id = r.id
                WHERE r.user_id = :userId
                    AND r.created_at >= :dateFrom
                GROUP BY p.id, p.name, p.normalized_name, p.category, p.brand
                HAVING COUNT(ri.id) >= 2
                ORDER BY purchase_count DESC, total_spent DESC
                LIMIT 20
            `, {
                replacements: { userId, dateFrom },
                type: sequelize.QueryTypes.SELECT
            });

            patterns.topProducts = topProducts;

            // 7. Product category preferences
            const categoryPreferences = await sequelize.query(`
                SELECT
                    p.category,
                    COUNT(ri.id) as item_count,
                    SUM(ri.quantity) as total_quantity,
                    SUM(ri.total_price) as total_spent,
                    AVG(ri.unit_price) as average_price
                FROM products p
                JOIN receipt_items ri ON p.id = ri.product_id
                JOIN receipts r ON ri.receipt_id = r.id
                WHERE r.user_id = :userId
                    AND r.created_at >= :dateFrom
                    AND p.category IS NOT NULL
                GROUP BY p.category
                ORDER BY total_spent DESC
            `, {
                replacements: { userId, dateFrom },
                type: sequelize.QueryTypes.SELECT
            });

            patterns.categoryPreferences = categoryPreferences;
        }

        // 8. Discount usage analysis (using raw query for better JSONB handling)
        const discountAnalysis = await sequelize.query(`
            SELECT
                discount_info->>'type' as "discountType",
                COUNT(id) as "usageCount",
                COALESCE(
                    SUM(
                        CASE
                            WHEN jsonb_typeof(discount_info->'amount') = 'number'
                            THEN (discount_info->>'amount')::DECIMAL
                            ELSE 0
                        END
                    ), 0
                ) as "totalSavings",
                COALESCE(
                    AVG(
                        CASE
                            WHEN jsonb_typeof(discount_info->'amount') = 'number'
                            THEN (discount_info->>'amount')::DECIMAL
                            ELSE NULL
                        END
                    ), 0
                ) as "averageSavings"
            FROM receipts
            WHERE user_id = :userId
                AND created_at >= :dateFrom
                AND discount_info IS NOT NULL
                AND discount_info->>'type' IS NOT NULL
            GROUP BY discount_info->>'type'
            ORDER BY "totalSavings" DESC
        `, {
            replacements: { userId, dateFrom },
            type: sequelize.QueryTypes.SELECT
        });

        patterns.discountAnalysis = discountAnalysis;

        // 9. VAT analysis by country (with proper JSONB nested access)
        const vatAnalysis = await sequelize.query(`
            SELECT
                country,
                COUNT(*) as receipt_count,
                COALESCE(
                    AVG(
                        CASE
                            WHEN jsonb_typeof(vat_info->'21') = 'object'
                                AND vat_info->'21'->>'amount' IS NOT NULL
                            THEN (vat_info->'21'->>'amount')::DECIMAL
                            ELSE NULL
                        END
                    ), 0
                ) as avg_vat_21,
                COALESCE(
                    AVG(
                        CASE
                            WHEN jsonb_typeof(vat_info->'9') = 'object'
                                AND vat_info->'9'->>'amount' IS NOT NULL
                            THEN (vat_info->'9'->>'amount')::DECIMAL
                            ELSE NULL
                        END
                    ), 0
                ) as avg_vat_9,
                SUM(amount) as total_amount
            FROM receipts
            WHERE user_id = :userId
                AND created_at >= :dateFrom
                AND vat_info IS NOT NULL
                AND country IS NOT NULL
            GROUP BY country
            ORDER BY receipt_count DESC
        `, {
            replacements: { userId, dateFrom },
            type: sequelize.QueryTypes.SELECT
        });

        patterns.vatAnalysis = vatAnalysis;

        // 10. Shopping frequency patterns
        const frequencyPatterns = await sequelize.query(`
            SELECT
                EXTRACT(DOW FROM created_at) as day_of_week,
                EXTRACT(HOUR FROM created_at) as hour_of_day,
                COUNT(*) as receipt_count,
                AVG(amount) as average_amount
            FROM receipts
            WHERE user_id = :userId
                AND created_at >= :dateFrom
                AND amount IS NOT NULL
            GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
            ORDER BY receipt_count DESC
        `, {
            replacements: { userId, dateFrom },
            type: sequelize.QueryTypes.SELECT
        });

        patterns.frequencyPatterns = frequencyPatterns;

        log.info('Purchase patterns analyzed successfully', {
            userId,
            days,
            categoriesFound: categorySpending.length,
            merchantsAnalyzed: patterns.merchantFrequency?.length || 0,
            productsAnalyzed: patterns.topProducts?.length || 0
        });

        return {
            success: true,
            data: patterns,
            metadata: {
                userId,
                analysisDate: new Date(),
                periodDays: days,
                dateFrom
            }
        };

    } catch (error) {
        log.error('Error analyzing purchase patterns', {
            userId,
            error: error.message,
            stack: error.stack
        });

        return {
            success: false,
            error: error.message
        };
    }
}

export async function getPriceHistoryAnalysis(productId, days = 180) {
    try {
        const priceHistory = await sequelize.query(`
            SELECT
                ri.unit_price,
                ri.total_price,
                ri.quantity,
                r.merchant_name,
                r.purchase_date,
                r.created_at,
                r.country,
                r.currency
            FROM receipt_items ri
            JOIN receipts r ON ri.receipt_id = r.id
            WHERE ri.product_id = :productId
                AND r.created_at >= :dateFrom
                AND ri.unit_price > 0
            ORDER BY r.created_at DESC
        `, {
            replacements: {
                productId,
                dateFrom: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            },
            type: sequelize.QueryTypes.SELECT
        });

        // Calculate price statistics
        const prices = priceHistory.map(item => parseFloat(item.unit_price));
        const statistics = {
            count: prices.length,
            min: Math.min(...prices),
            max: Math.max(...prices),
            average: prices.reduce((a, b) => a + b, 0) / prices.length,
            median: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
        };

        // Price trends by merchant
        const merchantPrices = priceHistory.reduce((acc, item) => {
            const merchant = item.merchant_name;
            if (!acc[merchant]) {
                acc[merchant] = [];
            }
            acc[merchant].push(parseFloat(item.unit_price));
            return acc;
        }, {});

        const merchantAnalysis = Object.entries(merchantPrices).map(([merchant, prices]) => ({
            merchant,
            count: prices.length,
            averagePrice: prices.reduce((a, b) => a + b, 0) / prices.length,
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices)
        })).sort((a, b) => b.count - a.count);

        return {
            success: true,
            data: {
                priceHistory,
                statistics,
                merchantAnalysis
            }
        };

    } catch (error) {
        log.error('Error analyzing price history', {
            productId,
            error: error.message
        });

        return {
            success: false,
            error: error.message
        };
    }
}
