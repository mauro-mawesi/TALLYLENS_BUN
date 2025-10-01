import User from './User.js';
import Receipt from './Receipt.js';
import RefreshToken from './RefreshToken.js';
import Product from './Product.js';
import ReceiptItem from './ReceiptItem.js';

// Define associations
const setupAssociations = () => {
    // User has many Receipts
    User.hasMany(Receipt, {
        foreignKey: 'user_id',
        as: 'receipts',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // Receipt belongs to User
    Receipt.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });

    // Receipt has many ReceiptItems
    Receipt.hasMany(ReceiptItem, {
        foreignKey: 'receipt_id',
        as: 'items',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // ReceiptItem belongs to Receipt
    ReceiptItem.belongsTo(Receipt, {
        foreignKey: 'receipt_id',
        as: 'receipt'
    });

    // Product has many ReceiptItems
    Product.hasMany(ReceiptItem, {
        foreignKey: 'product_id',
        as: 'receiptItems',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
    });

    // ReceiptItem belongs to Product
    ReceiptItem.belongsTo(Product, {
        foreignKey: 'product_id',
        as: 'product'
    });

    // User has many RefreshTokens
    User.hasMany(RefreshToken, {
        foreignKey: 'user_id',
        as: 'refreshTokens',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // RefreshToken belongs to User
    RefreshToken.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });
};

export default setupAssociations;