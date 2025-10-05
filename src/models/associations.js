import User from './User.js';
import Receipt from './Receipt.js';
import RefreshToken from './RefreshToken.js';
import Product from './Product.js';
import ReceiptItem from './ReceiptItem.js';
import Budget from './Budget.js';
import BudgetAlert from './BudgetAlert.js';
import NotificationPreference from './NotificationPreference.js';

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

    // User has many Products
    User.hasMany(Product, {
        foreignKey: 'user_id',
        as: 'products',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // Product belongs to User
    Product.belongsTo(User, {
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

    // User has many Budgets
    User.hasMany(Budget, {
        foreignKey: 'user_id',
        as: 'budgets',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // Budget belongs to User
    Budget.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });

    // Budget has many BudgetAlerts
    Budget.hasMany(BudgetAlert, {
        foreignKey: 'budget_id',
        as: 'alerts',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // BudgetAlert belongs to Budget
    BudgetAlert.belongsTo(Budget, {
        foreignKey: 'budget_id',
        as: 'budget'
    });

    // User has many BudgetAlerts
    User.hasMany(BudgetAlert, {
        foreignKey: 'user_id',
        as: 'budgetAlerts',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // BudgetAlert belongs to User
    BudgetAlert.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });

    // User has one NotificationPreference
    User.hasOne(NotificationPreference, {
        foreignKey: 'user_id',
        as: 'notificationPreference',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    // NotificationPreference belongs to User
    NotificationPreference.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });
};

export default setupAssociations;