import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import crypto from 'crypto';

const Receipt = sequelize.define('Receipt', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    userId: {
        field: 'user_id',
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    imageUrl: {
        field: 'image_url',
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
            notEmpty: {
                msg: 'Image URL/path is required'
            }
            // Removed isUrl validation - now accepts both URLs and relative paths (userId/receipts/filename)
        }
    },
    imageThumbnailUrl: {
        field: 'image_thumbnail_url',
        type: DataTypes.TEXT,
        allowNull: true
    },
    rawText: {
        field: 'raw_text',
        type: DataTypes.TEXT,
        allowNull: true
    },
    parsedData: {
        field: 'parsed_data',
        type: DataTypes.JSONB,
        allowNull: true
    },
    category: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isIn: {
                args: [['grocery', 'transport', 'food', 'fuel', 'others']],
                msg: 'Category must be one of: grocery, transport, food, fuel, others'
            }
        }
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
            isDecimal: {
                msg: 'Amount must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Amount cannot be negative'
            }
        }
    },
    currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'USD',
        allowNull: false,
        validate: {
            len: {
                args: [3, 3],
                msg: 'Currency must be a 3-letter code'
            }
        }
    },
    merchantName: {
        field: 'merchant_name',
        type: DataTypes.STRING,
        allowNull: true
    },
    purchaseDate: {
        field: 'purchase_date',
        type: DataTypes.DATE,
        allowNull: true
    },
    tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
        allowNull: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    isProcessed: {
        field: 'is_processed',
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    processingStatus: {
        field: 'processing_status',
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
        defaultValue: 'pending',
        allowNull: false
    },
    processingError: {
        field: 'processing_error',
        type: DataTypes.TEXT,
        allowNull: true
    },
    contentHash: {
        field: 'content_hash',
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'SHA-256 hash of normalized receipt content for duplicate detection'
    },
    paymentMethod: {
        field: 'payment_method',
        type: DataTypes.ENUM('cash', 'card', 'mobile', 'voucher', 'other'),
        allowNull: true
    },
    cardType: {
        field: 'card_type',
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Visa, Mastercard, etc.'
    },
    vatInfo: {
        field: 'vat_info',
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Tax/VAT breakdown by rate (global): {21: {amount: 4.20, base: 20.00}, 9: {amount: 0.18, base: 2.00}}'
    },
    discountInfo: {
        field: 'discount_info',
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Discount details: {type: "member", code: "VIP10", amount: 2.50, reason: "Loyalty discount"}'
    },
    country: {
        type: DataTypes.STRING(2),
        allowNull: true,
        validate: {
            len: [2, 2]
        },
        comment: 'ISO 3166-1 alpha-2 country code'
    }
}, {
    tableName: 'receipts',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id'] },
        { fields: ['category'] },
        { fields: ['created_at'] },
        { fields: ['purchase_date'] },
        { fields: ['processing_status'] },
        { fields: ['is_processed'] },
        { fields: ['content_hash'] },
        { fields: ['user_id', 'content_hash'], unique: true }
    ],
    hooks: {
        beforeCreate: (receipt) => {
            if (receipt.merchantName) {
                receipt.merchantName = receipt.merchantName.trim().toUpperCase();
            }
            if (receipt.cardType) {
                receipt.cardType = receipt.cardType.trim().toUpperCase();
            }
            if (receipt.country) {
                receipt.country = receipt.country.trim().toUpperCase();
            }
        },
        beforeUpdate: (receipt) => {
            if (receipt.changed('merchantName') && receipt.merchantName) {
                receipt.merchantName = receipt.merchantName.trim().toUpperCase();
            }
            if (receipt.changed('cardType') && receipt.cardType) {
                receipt.cardType = receipt.cardType.trim().toUpperCase();
            }
            if (receipt.changed('country') && receipt.country) {
                receipt.country = receipt.country.trim().toUpperCase();
            }
        }
    }
});

// Instance methods
Receipt.prototype.markAsProcessed = async function(parsedData) {
    return await this.update({
        isProcessed: true,
        processingStatus: 'completed',
        parsedData: parsedData,
        processingError: null
    });
};

Receipt.prototype.markAsFailed = async function(error) {
    return await this.update({
        processingStatus: 'failed',
        processingError: error.message || error
    });
};

// Class methods
Receipt.findByUser = async function(userId, options = {}) {
    return await this.findAll({
        where: { userId },
        ...options
    });
};

Receipt.getStatsByUser = async function(userId) {
    return await this.findAll({
        where: { userId },
        attributes: [
            'category',
            [sequelize.fn('COUNT', sequelize.col('category')), 'count'],
            [sequelize.fn('SUM', sequelize.col('amount')), 'total']
        ],
        group: ['category']
    });
};

// Generate content hash for duplicate detection
Receipt.generateContentHash = function(receiptData) {
    // Extract and normalize only reliable fields that uniquely identify a receipt
    const merchantNormalized = receiptData.merchantName ?
        receiptData.merchantName.toUpperCase().trim().replace(/[^A-Z0-9]/g, '') : '';

    // Use date without time for consistency (YYYY-MM-DD)
    const dateNormalized = receiptData.purchaseDate ?
        new Date(receiptData.purchaseDate).toISOString().split('T')[0] : '';

    // Normalize amount to 2 decimals
    const amountNormalized = receiptData.amount ?
        parseFloat(receiptData.amount).toFixed(2) : '0.00';

    // Include subtotal and tax if available for better uniqueness
    const subtotalNormalized = receiptData.totals?.subtotal ?
        parseFloat(receiptData.totals.subtotal).toFixed(2) : '';

    const taxNormalized = receiptData.totals?.tax ?
        parseFloat(receiptData.totals.tax).toFixed(2) : '';

    // Include item count for additional validation
    const itemCount = receiptData.itemCount || receiptData.items?.length || 0;

    // Create deterministic string from normalized fields
    const contentString = [
        merchantNormalized,
        dateNormalized,
        amountNormalized,
        subtotalNormalized,
        taxNormalized,
        itemCount.toString()
    ].filter(s => s).join('|');

    return crypto.createHash('sha256').update(contentString).digest('hex');
};

// Check for duplicate receipts
Receipt.findDuplicate = async function(userId, receiptData) {
    const contentHash = this.generateContentHash(receiptData);

    // First check by exact content hash
    const exactDuplicate = await this.findOne({
        where: {
            user_id: userId,
            contentHash
        }
    });

    if (exactDuplicate) {
        return {
            isDuplicate: true,
            type: 'exact',
            existingReceipt: exactDuplicate,
            reason: 'Contenido idéntico detectado'
        };
    }

    // If no exact match, check for similar receipts (same merchant, date, and similar amount)
    const merchantName = receiptData.merchantName;
    const purchaseDate = receiptData.purchaseDate;
    const amount = receiptData.amount || receiptData.totals?.total;

    if (merchantName && purchaseDate && amount) {
        const amountFloat = parseFloat(amount);
        const amountTolerance = Math.max(0.01, amountFloat * 0.02); // 2% tolerance or $0.01 minimum

        const similarReceipt = await this.findOne({
            where: {
                user_id: userId,
                merchantName: {
                    [sequelize.Sequelize.Op.iLike]: `%${merchantName.trim()}%`
                },
                purchaseDate: {
                    [sequelize.Sequelize.Op.eq]: new Date(purchaseDate)
                },
                amount: {
                    [sequelize.Sequelize.Op.between]: [amountFloat - amountTolerance, amountFloat + amountTolerance]
                }
            }
        });

        if (similarReceipt) {
            return {
                isDuplicate: true,
                type: 'similar',
                existingReceipt: similarReceipt,
                reason: 'Recibo similar encontrado (mismo comercio, fecha y monto aproximado)'
            };
        }
    }

    return {
        isDuplicate: false,
        contentHash
    };
};

// Full-text search using PostgreSQL tsvector
Receipt.fullTextSearch = async function(userId, query, options = {}) {
    const {
        limit = 20,
        offset = 0,
        category,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount
    } = options;

    // Build WHERE clause
    const whereConditions = ['user_id = :userId'];
    const replacements = { userId, query };

    if (category) {
        whereConditions.push('category = :category');
        replacements.category = category;
    }

    if (dateFrom) {
        whereConditions.push('purchase_date >= :dateFrom');
        replacements.dateFrom = dateFrom;
    }

    if (dateTo) {
        whereConditions.push('purchase_date <= :dateTo');
        replacements.dateTo = dateTo;
    }

    if (minAmount !== undefined) {
        whereConditions.push('amount >= :minAmount');
        replacements.minAmount = minAmount;
    }

    if (maxAmount !== undefined) {
        whereConditions.push('amount <= :maxAmount');
        replacements.maxAmount = maxAmount;
    }

    // Use plainto_tsquery for simple query parsing (handles spaces, punctuation)
    // Rank results by relevance using ts_rank
    const sql = `
        SELECT
            *,
            ts_rank(search_vector, plainto_tsquery('english', :query)) as search_rank
        FROM receipts
        WHERE ${whereConditions.join(' AND ')}
            AND search_vector @@ plainto_tsquery('english', :query)
        ORDER BY search_rank DESC, purchase_date DESC
        LIMIT :limit OFFSET :offset
    `;

    const receipts = await sequelize.query(sql, {
        replacements: { ...replacements, limit, offset },
        type: sequelize.QueryTypes.SELECT,
        model: Receipt,
        mapToModel: true
    });

    // Get total count for pagination
    const countSql = `
        SELECT COUNT(*) as total
        FROM receipts
        WHERE ${whereConditions.join(' AND ')}
            AND search_vector @@ plainto_tsquery('english', :query)
    `;

    const [{ total }] = await sequelize.query(countSql, {
        replacements,
        type: sequelize.QueryTypes.SELECT
    });

    return {
        receipts,
        total: parseInt(total),
        limit,
        offset
    };
};

// Get search suggestions based on existing data
Receipt.getSearchSuggestions = async function(userId, partialQuery, limit = 10) {
    if (!partialQuery || partialQuery.trim().length < 2) {
        return [];
    }

    const query = partialQuery.trim().toLowerCase();

    // Get suggestions from merchant names, categories, and tags
    const sql = `
        SELECT DISTINCT ON (suggestion)
            suggestion,
            type,
            count
        FROM (
            -- Merchant names
            SELECT
                merchant_name as suggestion,
                'merchant' as type,
                COUNT(*) as count
            FROM receipts
            WHERE user_id = :userId
                AND merchant_name ILIKE :query
            GROUP BY merchant_name

            UNION ALL

            -- Categories
            SELECT
                category as suggestion,
                'category' as type,
                COUNT(*) as count
            FROM receipts
            WHERE user_id = :userId
                AND category ILIKE :query
            GROUP BY category

            UNION ALL

            -- Tags
            SELECT
                UNNEST(tags) as suggestion,
                'tag' as type,
                COUNT(*) as count
            FROM receipts
            WHERE user_id = :userId
                AND EXISTS (
                    SELECT 1 FROM UNNEST(tags) t WHERE t ILIKE :query
                )
            GROUP BY UNNEST(tags)
        ) suggestions
        ORDER BY suggestion, count DESC
        LIMIT :limit
    `;

    return await sequelize.query(sql, {
        replacements: {
            userId,
            query: `%${query}%`,
            limit
        },
        type: sequelize.QueryTypes.SELECT
    });
};

export default Receipt;