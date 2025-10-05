import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { Op } from 'sequelize';

const Budget = sequelize.define('Budget', {
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
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: {
                msg: 'Budget name is required'
            },
            len: {
                args: [1, 255],
                msg: 'Budget name must be between 1 and 255 characters'
            }
        }
    },
    category: {
        type: DataTypes.STRING(50),
        allowNull: true, // null = global budget
        validate: {
            isIn: {
                args: [['grocery', 'transport', 'food', 'fuel', 'others', null]],
                msg: 'Category must be one of: grocery, transport, food, fuel, others, or null for global budget'
            }
        }
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            isDecimal: {
                msg: 'Amount must be a valid decimal number'
            },
            min: {
                args: [0.01],
                msg: 'Amount must be greater than 0'
            }
        }
    },
    period: {
        type: DataTypes.ENUM('weekly', 'monthly', 'yearly', 'custom'),
        allowNull: false,
        defaultValue: 'monthly'
    },
    startDate: {
        field: 'start_date',
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    endDate: {
        field: 'end_date',
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
            isAfterStartDate(value) {
                if (value <= this.startDate) {
                    throw new Error('End date must be after start date');
                }
            }
        }
    },
    currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
        validate: {
            len: {
                args: [3, 3],
                msg: 'Currency must be a 3-letter ISO code'
            }
        }
    },
    alertThresholds: {
        field: 'alert_thresholds',
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [50, 75, 90, 100],
        validate: {
            isValidThresholds(value) {
                if (!Array.isArray(value)) {
                    throw new Error('Alert thresholds must be an array');
                }
                if (value.some(t => typeof t !== 'number' || t < 0 || t > 200)) {
                    throw new Error('Alert thresholds must be numbers between 0 and 200');
                }
            }
        }
    },
    isActive: {
        field: 'is_active',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    isRecurring: {
        field: 'is_recurring',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    allowRollover: {
        field: 'allow_rollover',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    rolloverAmount: {
        field: 'rollover_amount',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        validate: {
            min: {
                args: [0],
                msg: 'Rollover amount cannot be negative'
            }
        }
    },
    notificationChannels: {
        field: 'notification_channels',
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: { push: true, email: false, inApp: true }
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    lastAlertSentAt: {
        field: 'last_alert_sent_at',
        type: DataTypes.DATE,
        allowNull: true
    },
    lastAlertThreshold: {
        field: 'last_alert_threshold',
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'budgets',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id'] },
        { fields: ['category'] },
        { fields: ['is_active'] },
        { fields: ['period'] },
        { fields: ['is_recurring'] },
        { fields: ['start_date', 'end_date'] },
        { fields: ['user_id', 'category', 'is_active'] },
        { fields: ['user_id', 'start_date', 'end_date'] }
    ]
});

// Instance methods

/**
 * Check if budget is currently active (within date range)
 */
Budget.prototype.isCurrentlyActive = function() {
    const now = new Date();
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    return this.isActive && now >= start && now <= end;
};

/**
 * Check if budget has expired
 */
Budget.prototype.hasExpired = function() {
    const now = new Date();
    const end = new Date(this.endDate);
    return now > end;
};

/**
 * Get days remaining in budget period
 */
Budget.prototype.daysRemaining = function() {
    const now = new Date();
    const end = new Date(this.endDate);
    const diff = end - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

/**
 * Calculate total budget including rollover
 */
Budget.prototype.getTotalBudget = function() {
    const baseAmount = parseFloat(this.amount);
    const rollover = parseFloat(this.rolloverAmount || 0);
    return baseAmount + rollover;
};

/**
 * Update last alert tracking
 */
Budget.prototype.updateLastAlert = async function(threshold) {
    return await this.update({
        lastAlertSentAt: new Date(),
        lastAlertThreshold: threshold
    });
};

/**
 * Deactivate budget
 */
Budget.prototype.deactivate = async function() {
    return await this.update({ isActive: false });
};

/**
 * Create next period budget (for recurring budgets)
 */
Budget.prototype.createNextPeriod = async function(rolloverAmount = 0) {
    if (!this.isRecurring) {
        throw new Error('Budget is not recurring');
    }

    const periodDays = {
        weekly: 7,
        monthly: 30,
        yearly: 365,
        custom: Math.ceil((new Date(this.endDate) - new Date(this.startDate)) / (1000 * 60 * 60 * 24))
    };

    const days = periodDays[this.period];
    const newStartDate = new Date(this.endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);

    const newEndDate = new Date(newStartDate);
    newEndDate.setDate(newEndDate.getDate() + days);

    return await Budget.create({
        userId: this.userId,
        name: this.name,
        category: this.category,
        amount: this.amount,
        period: this.period,
        startDate: newStartDate,
        endDate: newEndDate,
        currency: this.currency,
        alertThresholds: this.alertThresholds,
        isActive: true,
        isRecurring: this.isRecurring,
        allowRollover: this.allowRollover,
        rolloverAmount: rolloverAmount,
        notificationChannels: this.notificationChannels,
        metadata: this.metadata
    });
};

// Class methods (static)

/**
 * Get active budgets for a user
 */
Budget.findActiveByUser = async function(userId, options = {}) {
    return await this.findAll({
        where: {
            userId,
            isActive: true
        },
        order: [['startDate', 'DESC']],
        ...options
    });
};

/**
 * Get current budgets (active and within date range)
 */
Budget.findCurrentByUser = async function(userId, category = null) {
    const now = new Date();
    const where = {
        userId,
        isActive: true,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now }
    };

    if (category) {
        where.category = category;
    }

    return await this.findAll({
        where,
        order: [['startDate', 'DESC']]
    });
};

/**
 * Get expired budgets that need renewal
 */
Budget.findExpiredRecurring = async function() {
    const now = new Date();
    return await this.findAll({
        where: {
            isActive: true,
            isRecurring: true,
            endDate: { [Op.lt]: now }
        }
    });
};

/**
 * Get budgets by date range
 */
Budget.findByDateRange = async function(userId, startDate, endDate, options = {}) {
    return await this.findAll({
        where: {
            userId,
            [Op.or]: [
                {
                    startDate: { [Op.between]: [startDate, endDate] }
                },
                {
                    endDate: { [Op.between]: [startDate, endDate] }
                },
                {
                    [Op.and]: [
                        { startDate: { [Op.lte]: startDate } },
                        { endDate: { [Op.gte]: endDate } }
                    ]
                }
            ]
        },
        ...options
    });
};

/**
 * Get budget summary for user
 */
Budget.getSummaryByUser = async function(userId) {
    const budgets = await this.findCurrentByUser(userId);

    return {
        total: budgets.length,
        active: budgets.filter(b => b.isCurrentlyActive()).length,
        categories: [...new Set(budgets.map(b => b.category).filter(Boolean))],
        totalBudgetAmount: budgets.reduce((sum, b) => sum + parseFloat(b.getTotalBudget()), 0)
    };
};

/**
 * Duplicate budget
 */
Budget.duplicate = async function(budgetId, userId, newDates = {}) {
    const original = await this.findOne({ where: { id: budgetId, userId } });
    if (!original) {
        throw new Error('Budget not found');
    }

    const duplicate = await this.create({
        userId: original.userId,
        name: `${original.name} (Copy)`,
        category: original.category,
        amount: original.amount,
        period: original.period,
        startDate: newDates.startDate || original.startDate,
        endDate: newDates.endDate || original.endDate,
        currency: original.currency,
        alertThresholds: original.alertThresholds,
        isActive: true,
        isRecurring: original.isRecurring,
        allowRollover: original.allowRollover,
        rolloverAmount: 0,
        notificationChannels: original.notificationChannels,
        metadata: original.metadata
    });

    return duplicate;
};

export default Budget;
