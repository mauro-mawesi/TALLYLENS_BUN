import Product, { normalizeProductName } from '../models/Product.js';
import ReceiptItem from '../models/ReceiptItem.js';
import { log } from '../utils/logger.js';
import { categorizeProduct } from '../services/categorizationService.js';
import { mapUnitToInternal } from '../utils/categoryMapper.js';
import { Op } from 'sequelize';

export async function processReceiptItems(receiptId, userId, items, currency = 'USD', transaction = null, locale = 'en') {
    const processedItems = [];

    try {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // With the updated vision prompt, items already come normalized in English
            const translatedName = (item?.name ?? item?.originalText ?? '').toString().trim();
            if (!translatedName) {
                // Skip empty items gracefully
                log.warn('Skipping item without name', { receiptId, index: i });
                continue;
            }

            // Prefer category provided by AI; fallback to categorizeProduct only if missing/invalid
            const validCategories = ['food', 'beverages', 'cleaning', 'personal_care', 'pharmacy', 'transport', 'fuel', 'others'];
            let productCategory = (typeof item.category === 'string') ? item.category.toLowerCase().trim() : null;
            if (!validCategories.includes(productCategory)) {
                // Fallback categorization (1 call) only if category missing or invalid
                productCategory = await categorizeProduct(translatedName, locale);
                log.debug('Product category inferred via AI fallback', {
                    name: translatedName,
                    category: productCategory
                });
            } else {
                log.debug('Product category provided by AI used', {
                    name: translatedName,
                    category: productCategory
                });
            }

            // Find or create product with display name uppercased (scoped to user)
            const displayName = translatedName ? translatedName.toUpperCase() : translatedName;
            const { product, created } = await Product.findOrCreateByName(
                userId,
                displayName,
                {
                    category: productCategory,
                    unit: mapUnitToInternal(detectUnit(translatedName)) || 'unit'
                }
            );

            if (created) {
                log.info('New product created', {
                    productId: product.id,
                    originalName: item.name,
                    translatedName: translatedName,
                    category: productCategory,
                    receiptId
                });
            }

            // Create receipt item
            const receiptItem = await ReceiptItem.create({
                receiptId,
                productId: product.id,
                originalText: ((item.originalText || item.name || translatedName || '') + '').toUpperCase(),
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice || ((item.unitPrice || 0) * (item.quantity || 1)),
                currency,
                unit: mapUnitToInternal(detectUnit(translatedName)) || 'unit',
                position: item.position !== undefined ? item.position : i,
                confidence: calculateItemConfidence(item),
                rawData: {
                    ocrText: item.originalText,
                    extractedName: item.name,
                    translatedName: translatedName,
                    extractedPrice: item.unitPrice,
                    extractedQuantity: item.quantity,
                    detectedCategory: productCategory
                }
            }, { transaction });

            // Update product price statistics
            await product.updatePriceStats(item.unitPrice);

            processedItems.push({
                receiptItem,
                product,
                wasNewProduct: created
            });

            log.debug('Receipt item processed', {
                receiptId,
                productId: product.id,
                originalName: item.name,
                translatedName: translatedName,
                category: productCategory,
                unitPrice: item.unitPrice,
                quantity: item.quantity
            });
        }

        log.info('All receipt items processed', {
            receiptId,
            itemCount: items.length,
            newProductsCreated: processedItems.filter(p => p.wasNewProduct).length
        });

        return processedItems;

    } catch (error) {
        log.error('Error processing receipt items', {
            receiptId,
            error: error.message,
            itemCount: items.length
        });
        throw error;
    }
}

export function detectUnit(productName) {
    const name = (productName ?? '').toString().toLowerCase();

    // Weight units
    if (name.includes('kg') || name.includes('kilo') || name.includes('kilogramo')) return 'kg';
    if (name.includes('gr') || name.includes('gram') || name.includes('gramo')) return 'g';
    if (name.includes('lb') || name.includes('libra')) return 'kg';

    // Volume units
    if (name.includes('lt') || name.includes('liter') || name.includes('litro')) return 'l';
    if (name.includes('ml') || name.includes('mililitro')) return 'ml';
    if (name.includes('oz') || name.includes('onza')) return 'ml';

    // Packaging units
    if (name.includes('paquete') || name.includes('pack')) return 'package';
    if (name.includes('caja') || name.includes('box')) return 'box';
    if (name.includes('botella') || name.includes('bottle')) return 'bottle';
    if (name.includes('lata') || name.includes('can')) return 'unit';
    if (name.includes('frasco') || name.includes('jar')) return 'unit';

    return 'unit';
}

export function calculateItemConfidence(item) {
    let confidence = 0.5; // Base confidence

    // Boost confidence if we have all required fields
    if (item.name && item.name.length > 2) confidence += 0.2;
    if (item.unitPrice && item.unitPrice > 0) confidence += 0.2;
    if (item.quantity && item.quantity > 0) confidence += 0.1;

    // Boost confidence if values make sense
    if (item.totalPrice && item.unitPrice && item.quantity) {
        const calculatedTotal = item.unitPrice * item.quantity;
        const difference = Math.abs(calculatedTotal - item.totalPrice);
        if (difference < 0.01) {
            confidence += 0.1; // Prices match exactly
        } else if (difference < 0.1) {
            confidence += 0.05; // Close match
        }
    }

    // Reduce confidence for suspicious values
    if (item.unitPrice && (item.unitPrice < 0.01 || item.unitPrice > 1000)) {
        confidence -= 0.2;
    }

    if (item.quantity && (item.quantity < 0.01 || item.quantity > 100)) {
        confidence -= 0.1;
    }

    // Reduce confidence for very short or long product names
    if (item.name) {
        if (item.name.length < 3) confidence -= 0.2;
        if (item.name.length > 50) confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
}

export async function mergeProducts(userId, primaryProductId, duplicateProductId) {
    try {
        const primaryProduct = await Product.findByPk(primaryProductId);
        const duplicateProduct = await Product.findByPk(duplicateProductId);

        if (!primaryProduct || !duplicateProduct) {
            throw new Error('One or both products not found');
        }

        // Verify both products belong to the same user
        if (primaryProduct.userId !== userId || duplicateProduct.userId !== userId) {
            throw new Error('Products do not belong to this user');
        }

        // Update all receipt items to use primary product
        await ReceiptItem.update(
            { productId: primaryProductId },
            { where: { productId: duplicateProductId } }
        );

        // Merge product statistics
        const duplicateItems = await ReceiptItem.findAll({
            where: { productId: primaryProductId },
            order: [['createdAt', 'ASC']]
        });

        // Recalculate statistics for merged product
        if (duplicateItems.length > 0) {
            const prices = duplicateItems.map(item => parseFloat(item.unitPrice));
            const purchaseCount = duplicateItems.length;
            const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
            const lowestPrice = Math.min(...prices);
            const highestPrice = Math.max(...prices);
            const lastItem = duplicateItems[duplicateItems.length - 1];

            await primaryProduct.update({
                averagePrice,
                lowestPrice,
                highestPrice,
                lastSeenPrice: parseFloat(lastItem.unitPrice),
                lastSeenAt: lastItem.createdAt,
                purchaseCount
            });
        }

        // Delete duplicate product
        await duplicateProduct.destroy();

        log.info('Products merged successfully', {
            primaryProductId,
            duplicateProductId,
            itemsTransferred: duplicateItems.length
        });

        return primaryProduct;

    } catch (error) {
        log.error('Error merging products', {
            primaryProductId,
            duplicateProductId,
            error: error.message
        });
        throw error;
    }
}

export async function findPotentialDuplicates(userId, productId) {
    const product = await Product.findByPk(productId);
    if (!product) {
        throw new Error('Product not found');
    }

    // Verify product belongs to user
    if (product.userId !== userId) {
        throw new Error('Product does not belong to this user');
    }

    // Find products with similar normalized names (only from same user)
    const similarProducts = await Product.findAll({
        where: {
            userId,
            id: { [Op.ne]: productId },
            normalizedName: {
                [Op.iLike]: `%${product.normalizedName.substring(0, Math.min(10, product.normalizedName.length))}%`
            }
        },
        limit: 10
    });

    // Calculate similarity scores
    const duplicates = [];
    for (const similarProduct of similarProducts) {
        const similarity = calculateNameSimilarity(product.normalizedName, similarProduct.normalizedName);
        if (similarity > 0.8) {
            duplicates.push({
                product: similarProduct,
                similarity,
                reason: similarity > 0.95 ? 'Nearly identical names' : 'Very similar names'
            });
        }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
}

function calculateNameSimilarity(name1, name2) {
    // Simple similarity calculation using Levenshtein distance
    const longer = name1.length > name2.length ? name1 : name2;
    const shorter = name1.length > name2.length ? name2 : name1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}
