import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import Product from '../models/Product.js';
import ReceiptItem from '../models/ReceiptItem.js';
import Receipt from '../models/Receipt.js';
import { Op } from 'sequelize';
import sequelize from '../config/db.js';

// Get user's products with filtering and pagination
export const getProducts = asyncHandler(async (req, res) => {
    const { category, search, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;

    // Build where clause for user's products
    const whereClause = { userId };

    if (category) {
        whereClause.category = category;
    }
    if (search) {
        whereClause[Op.or] = [
            { name: { [Op.iLike]: `%${search}%` } },
            { normalizedName: { [Op.iLike]: `%${search}%` } },
            { brand: { [Op.iLike]: `%${search}%` } }
        ];
    }

    const products = await Product.findAndCountAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['lastSeenAt', 'DESC'], ['purchaseCount', 'DESC']]
    });

    res.json({
        status: 'success',
        data: {
            products: products.rows,
            total: products.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        }
    });
});

// Get single product details
export const getProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const product = await Product.findOne({
        where: {
            id,
            userId
        },
        include: [{
            model: ReceiptItem,
            as: 'receiptItems',
            include: [{
                model: Receipt,
                as: 'receipt',
                attributes: ['id', 'merchantName', 'purchaseDate']
            }],
            order: [['createdAt', 'DESC']],
            limit: 10
        }]
    });

    if (!product) {
        return res.status(404).json({
            status: 'error',
            message: req.t('products.not_found')
        });
    }

    res.json({
        status: 'success',
        data: product
    });
});

// Get product price history
export const getPriceHistory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { days = 90 } = req.query;
    const userId = req.user.id;

    const product = await Product.findOne({
        where: {
            id,
            userId
        }
    });

    if (!product) {
        return res.status(404).json({
            status: 'error',
            message: req.t('products.not_found')
        });
    }

    const priceStats = await ReceiptItem.getPriceStatsByProduct(id, parseInt(days));

    if (!priceStats) {
        return res.status(404).json({
            status: 'error',
            message: req.t('products.no_price_history')
        });
    }

    res.json({
        status: 'success',
        data: {
            product,
            ...priceStats
        }
    });
});

// Get user's top purchased products
export const getTopProducts = asyncHandler(async (req, res) => {
    const { limit = 20, days = 90 } = req.query;
    const userId = req.user.id;

    const topProducts = await ReceiptItem.getTopProducts(userId, parseInt(limit), parseInt(days));

    res.json({
        status: 'success',
        data: topProducts
    });
});

// Get products with significant price changes
export const getPriceAlerts = asyncHandler(async (req, res) => {
    const { threshold = 0.2 } = req.query;
    const userId = req.user.id;

    // Get products with recent purchases (last 30 days) and historical data
    const recentItems = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                createdAt: {
                    [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                }
            }
        }, {
            model: Product,
            as: 'product'
        }],
        order: [['createdAt', 'DESC']]
    });

    const priceAlerts = [];

    for (const item of recentItems) {
        const product = item.product;
        const currentPrice = parseFloat(item.unitPrice);

        if (product.averagePrice && Math.abs(product.averagePrice - currentPrice) > 0.01) {
            const priceChange = (currentPrice - product.averagePrice) / product.averagePrice;

            if (Math.abs(priceChange) >= parseFloat(threshold)) {
                priceAlerts.push({
                    product,
                    currentPrice,
                    averagePrice: product.averagePrice,
                    priceChange: Math.round(priceChange * 100) / 100,
                    changeType: priceChange > 0 ? 'increase' : 'decrease',
                    merchant: item.receipt.merchantName,
                    date: item.createdAt
                });
            }
        }
    }

    // Remove duplicates by product ID
    const uniqueAlerts = priceAlerts.filter((alert, index, self) =>
        index === self.findIndex(a => a.product.id === alert.product.id)
    );

    res.json({
        status: 'success',
        data: uniqueAlerts
    });
});

// Get spending breakdown by product category
export const getSpendingByCategory = asyncHandler(async (req, res) => {
    const { days = 90 } = req.query;
    const userId = req.user.id;

    const categorySpending = await ReceiptItem.findAll({
        include: [{
            model: Receipt,
            as: 'receipt',
            where: {
                userId,
                createdAt: {
                    [Op.gte]: new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000)
                }
            },
            attributes: []
        }, {
            model: Product,
            as: 'product',
            attributes: ['category']
        }],
        attributes: [
            [sequelize.col('product.category'), 'category'],
            [sequelize.fn('SUM', sequelize.col('total_price')), 'totalSpent'],
            [sequelize.fn('COUNT', sequelize.col('ReceiptItem.id')), 'itemCount'],
            [sequelize.fn('AVG', sequelize.col('unit_price')), 'averagePrice']
        ],
        group: ['product.category'],
        order: [[sequelize.literal('total_spent'), 'DESC']],
        raw: true
    });

    const formattedData = categorySpending.map(item => ({
        category: item.category || 'Sin categoría',
        totalSpent: parseFloat(item.totalSpent) || 0,
        itemCount: parseInt(item.itemCount) || 0,
        averagePrice: parseFloat(item.averagePrice) || 0
    }));

    res.json({
        status: 'success',
        data: formattedData
    });
});

// Update product information
export const updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, category, brand, unit, notes } = req.body;
    const userId = req.user.id;

    const product = await Product.findOne({
        where: {
            id,
            userId
        }
    });

    if (!product) {
        return res.status(404).json({
            status: 'error',
            message: req.t('products.not_found')
        });
    }

    // Update product
    const updateData = {};
    if (name) updateData.name = name;
    if (category) updateData.category = category;
    if (brand) updateData.brand = brand;
    if (unit) updateData.unit = unit;
    if (notes) updateData.description = notes;

    await product.update(updateData);

    log.info('Product updated', {
        productId: id,
        userId,
        changes: updateData
    });

    res.json({
        status: 'success',
        data: product
    });
});

// Get product suggestions based on name similarity
export const getProductSuggestions = asyncHandler(async (req, res) => {
    const { name } = req.query;

    if (!name || name.length < 2) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.min_length', { field: 'Product name', min: 2 })
        });
    }

    const suggestions = await Product.findSimilar(name, 0.6);

    res.json({
        status: 'success',
        data: suggestions.slice(0, 10) // Limit to 10 suggestions
    });
});

// Get price trends for multiple products
export const getPriceTrends = asyncHandler(async (req, res) => {
    const { productIds, days = 90 } = req.query;
    const userId = req.user.id;

    if (!productIds || !Array.isArray(productIds)) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.required_field', { field: 'Product IDs array' })
        });
    }

    const trends = [];

    for (const productId of productIds) {
        const priceStats = await ReceiptItem.getPriceStatsByProduct(productId, parseInt(days));

        if (priceStats) {
            // Verify user has access to this product
            const userHasAccess = await Receipt.findOne({
                where: { userId },
                include: [{
                    model: ReceiptItem,
                    as: 'items',
                    where: { productId },
                    attributes: ['id']
                }],
                attributes: ['id']
            });

            if (userHasAccess) {
                const product = await Product.findByPk(productId, {
                    attributes: ['id', 'name', 'category', 'brand']
                });

                trends.push({
                    product,
                    ...priceStats
                });
            }
        }
    }

    res.json({
        status: 'success',
        data: trends
    });
});