import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import Receipt from '../models/Receipt.js';
import ReceiptItem from '../models/ReceiptItem.js';
import Product from '../models/Product.js';
import { extractReceiptData } from '../services/ocrService.js';
import { categorizeReceipt } from '../services/categorizationService.js';
import { processReceiptItems } from '../services/receiptItemService.js';
import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import { mapCategoryToInternal, CATEGORY_INTERNAL_TO_LOCALIZED } from '../utils/categoryMapper.js';

// Get user's receipts with pagination and filtering
export const getReceipts = asyncHandler(async (req, res) => {
    const {
        category,
        merchant,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        limit = 20,
        offset = 0,
        includeItems = false,
        sortBy = 'purchaseDate',
        sortOrder = 'DESC'
    } = req.query;
    const userId = req.user.id;

    // Build where clause
    const whereClause = { userId };

    if (category) {
        // Map the input category to internal English format
        const internalCategory = mapCategoryToInternal(category);

        if (internalCategory) {
            // Since all data is now in English, we just filter by the internal category
            whereClause.category = internalCategory;
            log.debug(`Filtering by category: "${category}" -> "${internalCategory}"`);
        } else {
            log.warn(`Unknown category filter: "${category}"`);
            // Return no results for unknown categories
            whereClause.category = 'invalid_category_no_match';
        }
    }

    if (merchant) {
        // Improved merchant search - case insensitive and handles multiple words
        whereClause.merchantName = {
            [Op.iLike]: `%${merchant.trim()}%`
        };
    }

    if (dateFrom || dateTo) {
        whereClause.purchaseDate = {};
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            if (!isNaN(fromDate.getTime())) {
                whereClause.purchaseDate[Op.gte] = fromDate;
            }
        }
        if (dateTo) {
            const toDate = new Date(dateTo);
            if (!isNaN(toDate.getTime())) {
                // Set to end of day for inclusive filtering
                toDate.setHours(23, 59, 59, 999);
                whereClause.purchaseDate[Op.lte] = toDate;
            }
        }
    }

    if (minAmount !== undefined || maxAmount !== undefined) {
        whereClause.amount = {};

        if (minAmount !== undefined && minAmount !== null && minAmount !== '') {
            const min = parseFloat(minAmount);
            if (!isNaN(min) && min >= 0) {
                whereClause.amount[Op.gte] = min;
            }
        }

        if (maxAmount !== undefined && maxAmount !== null && maxAmount !== '') {
            const max = parseFloat(maxAmount);
            if (!isNaN(max) && max >= 0) {
                whereClause.amount[Op.lte] = max;
            }
        }
    }

    // Build include array
    const include = [];
    if (includeItems === 'true') {
        include.push({
            model: ReceiptItem,
            as: 'items',
            include: [{
                model: Product,
                as: 'product',
                attributes: ['id', 'name', 'category', 'brand']
            }],
            order: [['position', 'ASC']]
        });
    }

    // Validate sorting parameters
    const allowedSortFields = ['purchaseDate', 'createdAt', 'amount', 'merchantName', 'category'];
    const allowedSortOrders = ['ASC', 'DESC'];

    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'purchaseDate';
    const validSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    const receipts = await Receipt.findAndCountAll({
        where: whereClause,
        include,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [[validSortBy, validSortOrder]]
    });

    res.json({
        status: 'success',
        data: {
            receipts: receipts.rows,
            total: receipts.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        }
    });
});

// Get single receipt with items
export const getReceiptById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const receipt = await Receipt.findOne({
        where: { id, userId },
        include: [{
            model: ReceiptItem,
            as: 'items',
            include: [{
                model: Product,
                as: 'product',
                attributes: ['id', 'name', 'category', 'brand', 'unit']
            }],
            order: [['position', 'ASC']]
        }]
    });

    if (!receipt) {
        return res.status(404).json({
            status: 'error',
            message: req.t('receipts.not_found')
        });
    }

    res.json({
        status: 'success',
        data: receipt
    });
});

// Create a new receipt with OCR and item processing
export const createReceipt = asyncHandler(async (req, res) => {
    const { imageUrl, notes, category, forceDuplicate = false } = req.body;
    const userId = req.user.id;

    // Start transaction for atomic operations
    const transaction = await sequelize.transaction();

    try {
        // Extract data from receipt image
        log.info('Processing receipt image', { userId, imageUrl });
        const ocrResult = await extractReceiptData(imageUrl, req.locale);

        if (!ocrResult.success) {
            await transaction.rollback();
            return res.status(422).json({
                status: 'error',
                message: ocrResult.error || req.t('receipts.ocr_failed')
            });
        }

        // Check for duplicate receipts
        const duplicateCheck = await Receipt.findDuplicate(
            userId,
            ocrResult
        );

        if (duplicateCheck.isDuplicate && !forceDuplicate) {
            await transaction.rollback();

            log.info('Duplicate receipt detected', {
                userId,
                type: duplicateCheck.type,
                existingReceiptId: duplicateCheck.existingReceipt.id,
                reason: duplicateCheck.reason
            });

            return res.status(409).json({
                status: 'error',
                code: 'DUPLICATE_RECEIPT',
                message: duplicateCheck.reason,
                data: {
                    duplicateType: duplicateCheck.type,
                    existingReceipt: {
                        id: duplicateCheck.existingReceipt.id,
                        merchantName: duplicateCheck.existingReceipt.merchantName,
                        purchaseDate: duplicateCheck.existingReceipt.purchaseDate,
                        amount: duplicateCheck.existingReceipt.amount,
                        createdAt: duplicateCheck.existingReceipt.createdAt
                    }
                }
            });
        }

        // Log if duplicate was forced
        if (duplicateCheck.isDuplicate && forceDuplicate) {
            log.warn('Duplicate receipt creation forced by user', {
                userId,
                type: duplicateCheck.type,
                existingReceiptId: duplicateCheck.existingReceipt.id
            });
        }

        // Categorize receipt if category not provided
        let finalCategory = category;
        if (!finalCategory && ocrResult.rawText) {
            finalCategory = await categorizeReceipt(ocrResult.rawText, req.locale);
        }

        // Create receipt record
        const receiptData = {
            userId,
            imageUrl,
            rawText: ocrResult.rawText,
            parsedData: {
                merchantName: ocrResult.merchantName,
                purchaseDate: ocrResult.purchaseDate,
                totals: ocrResult.totals,
                currency: ocrResult.currency,
                itemCount: ocrResult.items?.length || 0,
                validation: ocrResult.validation,
                extractionMethod: ocrResult.extractionMethod,
                paymentMethod: ocrResult.paymentMethod,
                cardType: ocrResult.cardType,
                vatInfo: ocrResult.vatInfo,
                discountInfo: ocrResult.discountInfo
            },
            category: finalCategory,
            merchantName: ocrResult.merchantName ? ocrResult.merchantName.trim().toUpperCase() : null,
            purchaseDate: ocrResult.purchaseDate ? new Date(ocrResult.purchaseDate) : null,
            amount: ocrResult.totals?.total || null,
            currency: ocrResult.currency || 'USD',
            notes,
            processingStatus: 'processing',
            paymentMethod: ocrResult.paymentMethod || null,
            cardType: ocrResult.cardType ? ocrResult.cardType.toUpperCase() : null,
            vatInfo: ocrResult.vatInfo || null,
            discountInfo: ocrResult.discountInfo || null,
            country: ocrResult.country ? ocrResult.country.toUpperCase() : null,
            contentHash: duplicateCheck.isDuplicate && forceDuplicate
                ? duplicateCheck.contentHash + '_forced_' + Date.now()
                : duplicateCheck.contentHash
        };

        const receipt = await Receipt.create(receiptData, { transaction });

        // Process items if this is a grocery receipt and has items
        if (finalCategory === 'grocery' && ocrResult.items && ocrResult.items.length > 0) {
            log.info('Processing receipt items', {
                receiptId: receipt.id,
                itemCount: ocrResult.items.length
            });

            await processReceiptItems(receipt.id, ocrResult.items, ocrResult.currency, transaction, req.locale);
        }

        // Log validation warnings if any
        if (ocrResult.validation?.anomaliesDetected > 0) {
            log.warn('Receipt processed with anomalies', {
                receiptId: receipt.id,
                anomaliesCount: ocrResult.validation.anomaliesDetected,
                confidence: ocrResult.validation.confidence,
                anomalies: ocrResult.validation.anomalies
            });
        }

        // Mark receipt as processed
        await receipt.update({
            processingStatus: 'completed',
            isProcessed: true
        }, { transaction });

        await transaction.commit();

        // Fetch the complete receipt with items for response
        const completeReceipt = await Receipt.findByPk(receipt.id, {
            include: [{
                model: ReceiptItem,
                as: 'items',
                include: [{
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'category', 'brand']
                }],
                order: [['position', 'ASC']]
            }]
        });

        log.info('Receipt created successfully', {
            receiptId: receipt.id,
            userId,
            itemCount: completeReceipt.items?.length || 0,
            category: finalCategory
        });

        res.status(201).json({
            status: 'success',
            data: completeReceipt
        });

    } catch (error) {
        await transaction.rollback();
        log.error('Error creating receipt', {
            userId,
            imageUrl,
            error: error.message
        });

        res.status(500).json({
            status: 'error',
            message: 'Error processing receipt',
            details: error.message
        });
    }
});

// Update receipt
export const updateReceipt = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { category, notes, merchantName, purchaseDate, amount } = req.body;
    const userId = req.user.id;

    const receipt = await Receipt.findOne({
        where: { id, userId }
    });

    if (!receipt) {
        return res.status(404).json({
            status: 'error',
            message: req.t('receipts.not_found')
        });
    }

    const updateData = {};
    if (category) updateData.category = category;
    if (notes) updateData.notes = notes;
    if (merchantName) updateData.merchantName = merchantName.trim().toUpperCase();
    if (purchaseDate) updateData.purchaseDate = new Date(purchaseDate);
    if (amount) updateData.amount = parseFloat(amount);

    await receipt.update(updateData);

    log.info('Receipt updated', {
        receiptId: id,
        userId,
        changes: updateData
    });

    res.json({
        status: 'success',
        data: receipt
    });
});

// Delete receipt
export const deleteReceipt = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const receipt = await Receipt.findOne({
        where: { id, userId }
    });

    if (!receipt) {
        return res.status(404).json({
            status: 'error',
            message: req.t('receipts.not_found')
        });
    }

    await receipt.destroy();

    log.info('Receipt deleted', {
        receiptId: id,
        userId
    });

    res.json({
        status: 'success',
        message: 'Receipt deleted successfully'
    });
});

// Get receipt items
export const getReceiptItems = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify receipt ownership
    const receipt = await Receipt.findOne({
        where: { id, userId },
        attributes: ['id']
    });

    if (!receipt) {
        return res.status(404).json({
            status: 'error',
            message: req.t('receipts.not_found')
        });
    }

    const items = await ReceiptItem.findByReceipt(id);

    res.json({
        status: 'success',
        data: items
    });
});

// Update receipt item
export const updateReceiptItem = asyncHandler(async (req, res) => {
    const { receiptId, itemId } = req.params;
    const { quantity, unitPrice, isVerified } = req.body;
    const userId = req.user.id;

    // Verify receipt ownership
    const receipt = await Receipt.findOne({
        where: { id: receiptId, userId },
        attributes: ['id']
    });

    if (!receipt) {
        return res.status(404).json({
            status: 'error',
            message: req.t('receipts.not_found')
        });
    }

    const item = await ReceiptItem.findOne({
        where: { id: itemId, receiptId }
    });

    if (!item) {
        return res.status(404).json({
            status: 'error',
            message: 'Receipt item not found'
        });
    }

    const updateData = {};
    if (quantity !== undefined) updateData.quantity = parseFloat(quantity);
    if (unitPrice !== undefined) updateData.unitPrice = parseFloat(unitPrice);
    if (isVerified !== undefined) updateData.isVerified = Boolean(isVerified);

    // Recalculate total price if quantity or unit price changed
    if (updateData.quantity || updateData.unitPrice) {
        const newQuantity = updateData.quantity || item.quantity;
        const newUnitPrice = updateData.unitPrice || item.unitPrice;
        updateData.totalPrice = newQuantity * newUnitPrice;
    }

    await item.update(updateData);

    // Update product price statistics
    if (updateData.unitPrice) {
        const product = await Product.findByPk(item.productId);
        if (product) {
            await product.updatePriceStats(updateData.unitPrice);
        }
    }

    log.info('Receipt item updated', {
        receiptId,
        itemId,
        userId,
        changes: updateData
    });

    res.json({
        status: 'success',
        data: item
    });
});

// Get receipt statistics
export const getReceiptStats = asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const userId = req.user.id;

    const dateFrom = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    const stats = await Receipt.findAll({
        where: {
            userId,
            createdAt: { [Op.gte]: dateFrom }
        },
        attributes: [
            'category',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
            [sequelize.fn('AVG', sequelize.col('amount')), 'averageAmount']
        ],
        group: ['category'],
        order: [[sequelize.literal('total_amount'), 'DESC']]
    });

    const totalStats = await Receipt.findOne({
        where: {
            userId,
            createdAt: { [Op.gte]: dateFrom }
        },
        attributes: [
            [sequelize.fn('COUNT', sequelize.col('id')), 'totalReceipts'],
            [sequelize.fn('SUM', sequelize.col('amount')), 'totalSpent'],
            [sequelize.fn('AVG', sequelize.col('amount')), 'averageReceipt']
        ]
    });

    res.json({
        status: 'success',
        data: {
            byCategory: stats,
            totals: totalStats,
            period: `${days} days`
        }
    });
});
