import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Product = sequelize.define('Product', {
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
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: {
                args: [1, 255],
                msg: 'Product name must be between 1 and 255 characters'
            }
        }
    },
    normalizedName: {
        field: 'normalized_name',
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: {
                args: [1, 255],
                msg: 'Normalized name must be between 1 and 255 characters'
            }
        }
    },
    category: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isIn: {
                args: [['food', 'beverages', 'cleaning', 'personal_care', 'pharmacy', 'transport', 'fuel', 'others']],
                msg: 'Category must be one of: food, beverages, cleaning, personal_care, pharmacy, transport, fuel, others'
            }
        }
    },
    brand: {
        type: DataTypes.STRING,
        allowNull: true
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
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    barcode: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
        allowNull: false
    },
    averagePrice: {
        field: 'average_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
            isDecimal: {
                msg: 'Average price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Average price cannot be negative'
            }
        }
    },
    lowestPrice: {
        field: 'lowest_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
            isDecimal: {
                msg: 'Lowest price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Lowest price cannot be negative'
            }
        }
    },
    highestPrice: {
        field: 'highest_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
            isDecimal: {
                msg: 'Highest price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Highest price cannot be negative'
            }
        }
    },
    lastSeenPrice: {
        field: 'last_seen_price',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: {
            isDecimal: {
                msg: 'Last seen price must be a valid decimal number'
            },
            min: {
                args: [0],
                msg: 'Last seen price cannot be negative'
            }
        }
    },
    lastSeenAt: {
        field: 'last_seen_at',
        type: DataTypes.DATE,
        allowNull: true
    },
    purchaseCount: {
        field: 'purchase_count',
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: {
            min: {
                args: [0],
                msg: 'Purchase count cannot be negative'
            }
        }
    },
    weight: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Product weight/volume: "1.5L", "500g", "2kg", etc.'
    },
    isOrganic: {
        field: 'is_organic',
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    nutritionalInfo: {
        field: 'nutritional_info',
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Basic nutritional information if available'
    }
}, {
    tableName: 'products',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id'] },
        { fields: ['user_id', 'normalized_name'], unique: true },
        { fields: ['category'] },
        { fields: ['brand'] },
        { fields: ['barcode'], unique: true, where: { barcode: { [sequelize.Sequelize.Op.not]: null } } },
        { fields: ['average_price'] },
        { fields: ['last_seen_at'] },
        { fields: ['purchase_count'] }
    ],
    hooks: {
        beforeCreate: (product) => {
            product.normalizedName = normalizeProductName(product.name);
        },
        beforeUpdate: (product) => {
            if (product.changed('name')) {
                product.normalizedName = normalizeProductName(product.name);
            }
        }
    }
});

// Helper function to normalize product names for matching
function normalizeProductName(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[áàäâã]/g, 'a')
        .replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i')
        .replace(/[óòöôõ]/g, 'o')
        .replace(/[úùüû]/g, 'u')
        .replace(/ñ/g, 'n')
        .replace(/ç/g, 'c')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Instance methods
Product.prototype.updatePriceStats = async function(newPrice) {
    const updates = {
        lastSeenPrice: newPrice,
        lastSeenAt: new Date(),
        purchaseCount: this.purchaseCount + 1
    };

    if (!this.lowestPrice || newPrice < this.lowestPrice) {
        updates.lowestPrice = newPrice;
    }

    if (!this.highestPrice || newPrice > this.highestPrice) {
        updates.highestPrice = newPrice;
    }

    // Calculate new average (simplified)
    if (this.averagePrice) {
        updates.averagePrice = ((this.averagePrice * this.purchaseCount) + newPrice) / (this.purchaseCount + 1);
    } else {
        updates.averagePrice = newPrice;
    }

    return await this.update(updates);
};

// Class methods
Product.findOrCreateByName = async function(userId, name, additionalData = {}) {
    const normalizedName = normalizeProductName(name);

    const [product, created] = await this.findOrCreate({
        where: {
            userId,
            normalizedName
        },
        defaults: {
            userId,
            name,
            normalizedName,
            ...additionalData
        }
    });

    return { product, created };
};

Product.findSimilar = async function(userId, name, threshold = 0.8) {
    const normalizedName = normalizeProductName(name);

    // Simple similarity search - can be enhanced with more sophisticated algorithms
    return await this.findAll({
        where: {
            userId,
            normalizedName: {
                [sequelize.Sequelize.Op.iLike]: `%${normalizedName}%`
            }
        },
        limit: 10
    });
};

Product.getPriceHistory = async function(productId, days = 30) {
    const product = await this.findByPk(productId, {
        include: [{
            association: 'receiptItems',
            include: [{
                association: 'receipt',
                attributes: ['purchaseDate', 'merchantName']
            }],
            where: {
                createdAt: {
                    [sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                }
            },
            order: [['createdAt', 'DESC']]
        }]
    });

    return product;
};

export default Product;
export { normalizeProductName };