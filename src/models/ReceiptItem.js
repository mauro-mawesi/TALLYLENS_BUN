import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const ReceiptItem = sequelize.define('ReceiptItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    receiptId: {
        field: 'receipt_id',
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'receipts',
            key: 'id'
        }
    },
    productId: {
        field: 'product_id',
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'products',
            key: 'id'
        }
    },
    originalText: {
        field: 'original_text',
        type: DataTypes.TEXT,
        allowNull: false
    },
    quantity: {
        type: DataTypes.DECIMAL(10, 3),
        allowNull: false,
        defaultValue: 1,
        validate: {
            isDecimal: {
                msg: 'Quantity must be a valid decimal number'
            },
            min: {
                args: [0.001],
                msg: 'Quantity must be greater than 0'
            }
        }
    },
    unitPrice: {
        field: 'unit_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            isDecimal: {
                msg: 'Unit price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Unit price cannot be negative'
            }
        }
    },
    totalPrice: {
        field: 'total_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            isDecimal: {
                msg: 'Total price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Total price cannot be negative'
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
    unit: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'unit',
        validate: {
            isIn: {
                args: [['unit', 'kg', 'g', 'l', 'ml', 'package', 'box', 'bottle']],
                msg: 'Unit must be one of: unit, kg, g, l, ml, package, box, bottle'
            }
        }
    },
    discount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        validate: {
            isDecimal: {
                msg: 'Discount must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Discount cannot be negative'
            }
        }
    },
    tax: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        validate: {
            isDecimal: {
                msg: 'Tax must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Tax cannot be negative'
            }
        }
    },
    confidence: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Confidence cannot be negative'
            },
            max: {
                args: [1],
                msg: 'Confidence cannot be greater than 1'
            }
        }
    },
    isVerified: {
        field: 'is_verified',
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Position cannot be negative'
            }
        }
    },
    rawData: {
        field: 'raw_data',
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: 'receipt_items',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['receipt_id'] },
        { fields: ['product_id'] },
        { fields: ['unit_price'] },
        { fields: ['total_price'] },
        { fields: ['created_at'] },
        { fields: ['is_verified'] },
        { fields: ['position'] },
        { fields: ['receipt_id', 'position'], unique: true }
    ],
    hooks: {
        beforeCreate: (receiptItem) => {
            // Ensure total price consistency
            if (receiptItem.quantity && receiptItem.unitPrice) {
                const calculatedTotal = (receiptItem.quantity * receiptItem.unitPrice) - (receiptItem.discount || 0) + (receiptItem.tax || 0);
                if (!receiptItem.totalPrice || Math.abs(receiptItem.totalPrice - calculatedTotal) > 0.01) {
                    receiptItem.totalPrice = calculatedTotal;
                }
            }
        },
        beforeUpdate: (receiptItem) => {
            // Ensure total price consistency on update
            if (receiptItem.changed('quantity') || receiptItem.changed('unitPrice') || receiptItem.changed('discount') || receiptItem.changed('tax')) {
                const calculatedTotal = (receiptItem.quantity * receiptItem.unitPrice) - (receiptItem.discount || 0) + (receiptItem.tax || 0);
                receiptItem.totalPrice = calculatedTotal;
            }
        }
    }
});

// Instance methods
ReceiptItem.prototype.calculateUnitPrice = function() {
    if (this.quantity > 0) {
        return (this.totalPrice + (this.discount || 0) - (this.tax || 0)) / this.quantity;
    }
    return this.unitPrice;
};

ReceiptItem.prototype.verify = async function() {
    return await this.update({ isVerified: true });
};

ReceiptItem.prototype.updatePrice = async function(unitPrice, quantity = null) {
    const updates = { unitPrice };

    if (quantity !== null) {
        updates.quantity = quantity;
    }

    // Recalculate total price
    updates.totalPrice = (quantity || this.quantity) * unitPrice - (this.discount || 0) + (this.tax || 0);

    return await this.update(updates);
};

// Class methods
ReceiptItem.findByReceipt = async function(receiptId, options = {}) {
    return await this.findAll({
        where: { receiptId },
        include: [{
            association: 'product',
            attributes: ['id', 'name', 'category', 'brand', 'unit']
        }],
        order: [['position', 'ASC'], ['createdAt', 'ASC']],
        ...options
    });
};

ReceiptItem.findByProduct = async function(productId, options = {}) {
    return await this.findAll({
        where: { productId },
        include: [{
            association: 'receipt',
            attributes: ['id', 'merchantName', 'purchaseDate', 'currency']
        }],
        order: [['createdAt', 'DESC']],
        ...options
    });
};

ReceiptItem.getPriceStatsByProduct = async function(productId, days = 90) {
    const items = await this.findAll({
        where: {
            productId,
            createdAt: {
                [sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            }
        },
        include: [{
            association: 'receipt',
            attributes: ['merchantName', 'purchaseDate']
        }],
        order: [['createdAt', 'DESC']]
    });

    if (items.length === 0) {
        return null;
    }

    const prices = items.map(item => parseFloat(item.unitPrice));
    const totalQuantity = items.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
    const totalSpent = items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);

    return {
        count: items.length,
        totalQuantity,
        totalSpent,
        averagePrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        lastPrice: prices[0],
        priceHistory: items.map(item => ({
            price: parseFloat(item.unitPrice),
            date: item.createdAt,
            merchant: item.receipt.merchantName,
            quantity: parseFloat(item.quantity)
        }))
    };
};

ReceiptItem.getTopProducts = async function(userId, limit = 20, days = 90) {
    return await this.findAll({
        include: [{
            association: 'product',
            attributes: ['id', 'name', 'category', 'brand']
        }, {
            association: 'receipt',
            attributes: [],
            where: {
                userId,
                createdAt: {
                    [sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                }
            }
        }],
        attributes: [
            'productId',
            [sequelize.fn('COUNT', sequelize.col('ReceiptItem.id')), 'purchaseCount'],
            [sequelize.fn('SUM', sequelize.col('quantity')), 'totalQuantity'],
            [sequelize.fn('SUM', sequelize.col('total_price')), 'totalSpent'],
            [sequelize.fn('AVG', sequelize.col('unit_price')), 'averagePrice']
        ],
        group: ['ReceiptItem.product_id', 'product.id'],
        order: [[sequelize.literal('purchase_count'), 'DESC']],
        limit
    });
};

export default ReceiptItem;