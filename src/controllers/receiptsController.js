import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import Receipt from '../models/Receipt.js';
import ReceiptItem from '../models/ReceiptItem.js';
import Product from '../models/Product.js';
import SearchHistory from '../models/SearchHistory.js';
import SavedFilter from '../models/SavedFilter.js';
import { extractReceiptData } from '../services/ocrService.js';
import { categorizeReceipt } from '../services/categorizationService.js';
import { processReceiptItems } from '../services/receiptItemService.js';
import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import { mapCategoryToInternal, CATEGORY_INTERNAL_TO_LOCALIZED } from '../utils/categoryMapper.js';
import { addSignedUrlsToReceipt } from '../utils/urlSigner.js';

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

    // Add signed URLs to each receipt (1 hour expiration for list view)
    const receiptsWithSignedUrls = receipts.rows.map(receipt => {
        const receiptJson = receipt.toJSON();
        return addSignedUrlsToReceipt(receiptJson, 3600); // 1 hour
    });

    res.json({
        status: 'success',
        data: {
            receipts: receiptsWithSignedUrls,
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

    // Add signed URLs to receipt (2 hours expiration for detail view)
    const receiptWithSignedUrls = addSignedUrlsToReceipt(receipt.toJSON(), 7200);

    res.json({
        status: 'success',
        data: receiptWithSignedUrls
    });
});

// Create a new receipt with OCR and item processing
export const createReceipt = asyncHandler(async (req, res) => {
    let { imageUrl, notes, category, forceDuplicate = false, processedByMLKit = false, source } = req.body;
    const userId = req.user.id;

    // If imageUrl is a signed URL, extract the relative path
    // Format: https://api.tallylens.app/secure/userId/receipts/file.jpg?expires=XXX&signature=YYY
    // We want: userId/receipts/file.jpg
    if (imageUrl) {
        try {
            // Robust normalization: handle signed /secure URLs and legacy /uploads URLs
            if (imageUrl.includes('/secure/') || imageUrl.startsWith('http')) {
                const urlObj = new URL(imageUrl);
                imageUrl = urlObj.pathname.replace(/^\/secure\//, '').replace(/^\/uploads\//, '');
                log.info('Normalized imageUrl from URL to relative path', { imageUrl });
            } else if (imageUrl.includes('/uploads/')) {
                imageUrl = imageUrl.replace(/^\/uploads\//, '');
                log.info('Normalized legacy /uploads imageUrl to relative path', { imageUrl });
            }
        } catch (e) {
            log.warn('Could not normalize imageUrl, using as-is', { imageUrl });
        }
    }

    // Start transaction for atomic operations
    const transaction = await sequelize.transaction();

    try {
        // Extract data from receipt image
        const skipEnhancement = Boolean(processedByMLKit) && (source === 'camera' || !source);
        log.info('Processing receipt image', { userId, imageUrl, processedByMLKit, source, skipEnhancement });
        const ocrResult = await extractReceiptData(imageUrl, req.locale, { skipEnhancement, source, processedByMLKit });

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

        // Determine final category
        // Priority:
        // 1) Explicit category from request
        // 2) Category provided by AI pipeline (already internal english)
        // 3) Fallback: categorize from rawText (if any)
        let finalCategory = category;
        if (!finalCategory && ocrResult.category) {
            finalCategory = ocrResult.category;
        }
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
        if (finalCategory === 'grocery' && Array.isArray(ocrResult.items) && ocrResult.items.length > 0) {
            log.info('Processing receipt items', {
                receiptId: receipt.id,
                userId: req.user.id,
                itemCount: ocrResult.items.length
            });

            await processReceiptItems(receipt.id, req.user.id, ocrResult.items, ocrResult.currency, transaction, req.locale);
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
        // Order by the alias defined in attributes ('totalAmount')
        order: [[sequelize.col('totalAmount'), 'DESC']]
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

    // Count unique products from receipt items using raw query for better performance
    const uniqueProductsResult = await sequelize.query(`
        SELECT COUNT(DISTINCT ri.product_id) as "uniqueProducts"
        FROM receipt_items ri
        INNER JOIN receipts r ON ri.receipt_id = r.id
        WHERE r.user_id = :userId
        AND r.created_at >= :dateFrom
        AND ri.product_id IS NOT NULL
    `, {
        replacements: { userId, dateFrom },
        type: sequelize.QueryTypes.SELECT
    });

    const uniqueProducts = parseInt(uniqueProductsResult[0]?.uniqueProducts || 0);

    // Count unique merchants
    const uniqueMerchantsResult = await sequelize.query(`
        SELECT COUNT(DISTINCT merchant_name) as "uniqueMerchants"
        FROM receipts
        WHERE user_id = :userId
        AND created_at >= :dateFrom
        AND merchant_name IS NOT NULL
    `, {
        replacements: { userId, dateFrom },
        type: sequelize.QueryTypes.SELECT
    });

    const uniqueMerchants = parseInt(uniqueMerchantsResult[0]?.uniqueMerchants || 0);

    res.json({
        status: 'success',
        data: {
            byCategory: stats,
            totals: {
                ...totalStats?.dataValues,
                uniqueProducts,
                uniqueMerchants
            },
            period: `${days} days`
        }
    });
});

// Full-text search receipts
export const searchReceipts = asyncHandler(async (req, res) => {
    const {
        q,
        category,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        limit = 20,
        offset = 0
    } = req.query;
    const userId = req.user.id;

    if (!q || q.trim().length < 2) {
        return res.status(400).json({
            status: 'error',
            message: req.t('search.query_too_short')
        });
    }

    const options = {
        limit: parseInt(limit),
        offset: parseInt(offset)
    };

    if (category) {
        const internalCategory = mapCategoryToInternal(category);
        if (internalCategory) {
            options.category = internalCategory;
        }
    }

    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        if (!isNaN(fromDate.getTime())) {
            options.dateFrom = fromDate;
        }
    }

    if (dateTo) {
        const toDate = new Date(dateTo);
        if (!isNaN(toDate.getTime())) {
            toDate.setHours(23, 59, 59, 999);
            options.dateTo = toDate;
        }
    }

    if (minAmount !== undefined) {
        const min = parseFloat(minAmount);
        if (!isNaN(min) && min >= 0) {
            options.minAmount = min;
        }
    }

    if (maxAmount !== undefined) {
        const max = parseFloat(maxAmount);
        if (!isNaN(max) && max >= 0) {
            options.maxAmount = max;
        }
    }

    const result = await Receipt.fullTextSearch(userId, q.trim(), options);

    // Save to search history
    await SearchHistory.addSearch(userId, q.trim(), result.total);

    log.info('Full-text search performed', {
        userId,
        query: q.trim(),
        results: result.total
    });

    res.json({
        status: 'success',
        data: result
    });
});

// Get search suggestions
export const getSearchSuggestions = asyncHandler(async (req, res) => {
    const { q, limit = 10 } = req.query;
    const userId = req.user.id;

    if (!q || q.trim().length < 2) {
        return res.json({
            status: 'success',
            data: {
                suggestions: []
            }
        });
    }

    const suggestions = await Receipt.getSearchSuggestions(
        userId,
        q.trim(),
        parseInt(limit)
    );

    res.json({
        status: 'success',
        data: {
            suggestions
        }
    });
});

// Get search history
export const getSearchHistory = asyncHandler(async (req, res) => {
    const { limit = 20, type = 'recent' } = req.query;
    const userId = req.user.id;

    let history;
    if (type === 'popular') {
        history = await SearchHistory.getPopularSearches(userId, parseInt(limit));
    } else {
        history = await SearchHistory.getRecentSearches(userId, parseInt(limit));
    }

    res.json({
        status: 'success',
        data: {
            history,
            type
        }
    });
});

// Clear search history
export const clearSearchHistory = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    await SearchHistory.destroy({
        where: { userId }
    });

    log.info('Search history cleared', { userId });

    res.json({
        status: 'success',
        message: req.t('search.history_cleared')
    });
});

// Get saved filters
export const getSavedFilters = asyncHandler(async (req, res) => {
    const { activeOnly = true } = req.query;
    const userId = req.user.id;

    const filters = await SavedFilter.getUserFilters(userId, activeOnly === 'true');

    res.json({
        status: 'success',
        data: {
            filters
        }
    });
});

// Create saved filter
export const createSavedFilter = asyncHandler(async (req, res) => {
    const { name, description, filters } = req.body;
    const userId = req.user.id;

    const savedFilter = await SavedFilter.create({
        userId,
        name,
        description,
        filters
    });

    log.info('Saved filter created', {
        userId,
        filterId: savedFilter.id,
        name
    });

    res.status(201).json({
        status: 'success',
        message: req.t('search.filter_saved'),
        data: {
            filter: savedFilter
        }
    });
});

// Update saved filter
export const updateSavedFilter = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, filters, isActive } = req.body;
    const userId = req.user.id;

    const savedFilter = await SavedFilter.findOne({
        where: { id, userId }
    });

    if (!savedFilter) {
        return res.status(404).json({
            status: 'error',
            message: req.t('search.filter_not_found')
        });
    }

    await savedFilter.update({
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(filters && { filters }),
        ...(isActive !== undefined && { isActive })
    });

    res.json({
        status: 'success',
        message: req.t('search.filter_updated'),
        data: {
            filter: savedFilter
        }
    });
});

// Delete saved filter
export const deleteSavedFilter = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const savedFilter = await SavedFilter.findOne({
        where: { id, userId }
    });

    if (!savedFilter) {
        return res.status(404).json({
            status: 'error',
            message: req.t('search.filter_not_found')
        });
    }

    await savedFilter.destroy();

    log.info('Saved filter deleted', {
        userId,
        filterId: id
    });

    res.json({
        status: 'success',
        message: req.t('search.filter_deleted')
    });
});

// Use saved filter (increment count)
export const useSavedFilter = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const savedFilter = await SavedFilter.findOne({
        where: { id, userId }
    });

    if (!savedFilter) {
        return res.status(404).json({
            status: 'error',
            message: req.t('search.filter_not_found')
        });
    }

    await savedFilter.incrementUseCount();

    res.json({
        status: 'success',
        data: {
            filter: savedFilter
        }
    });
});
