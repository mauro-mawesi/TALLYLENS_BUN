import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { Op } from 'sequelize';

const BudgetAlert = sequelize.define('BudgetAlert', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    budgetId: {
        field: 'budget_id',
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'budgets',
            key: 'id'
        }
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
    alertType: {
        field: 'alert_type',
        type: DataTypes.ENUM('threshold', 'predictive', 'comparative', 'digest', 'exceeded'),
        allowNull: false,
        validate: {
            isIn: {
                args: [['threshold', 'predictive', 'comparative', 'digest', 'exceeded']],
                msg: 'Alert type must be one of: threshold, predictive, comparative, digest, exceeded'
            }
        }
    },
    threshold: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Threshold must be a positive number'
            },
            max: {
                args: [200],
                msg: 'Threshold cannot exceed 200'
            }
        }
    },
    currentSpending: {
        field: 'current_spending',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: {
                args: [0],
                msg: 'Current spending cannot be negative'
            }
        }
    },
    budgetAmount: {
        field: 'budget_amount',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
            min: {
                args: [0],
                msg: 'Budget amount must be positive'
            }
        }
    },
    percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        validate: {
            min: {
                args: [0],
                msg: 'Percentage cannot be negative'
            }
        }
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
            notEmpty: {
                msg: 'Alert message is required'
            }
        }
    },
    sentVia: {
        field: 'sent_via',
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: ['inApp'],
        validate: {
            isValidChannels(value) {
                if (!Array.isArray(value)) {
                    throw new Error('sentVia must be an array');
                }
                const validChannels = ['push', 'email', 'inApp'];
                const invalidChannels = value.filter(ch => !validChannels.includes(ch));
                if (invalidChannels.length > 0) {
                    throw new Error(`Invalid channels: ${invalidChannels.join(', ')}`);
                }
            }
        }
    },
    sentAt: {
        field: 'sent_at',
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    wasRead: {
        field: 'was_read',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    readAt: {
        field: 'read_at',
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    }
}, {
    tableName: 'budget_alerts',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['budget_id'] },
        { fields: ['user_id'] },
        { fields: ['alert_type'] },
        { fields: ['was_read'] },
        { fields: ['sent_at'] },
        { fields: ['user_id', 'was_read', 'sent_at'] },
        { fields: ['budget_id', 'alert_type', 'sent_at'] }
    ],
    hooks: {
        beforeUpdate: (alert) => {
            // Automatically set readAt when wasRead changes to true
            if (alert.changed('wasRead') && alert.wasRead === true && !alert.readAt) {
                alert.readAt = new Date();
            }
        }
    }
});

// Instance methods

/**
 * Mark alert as read
 */
BudgetAlert.prototype.markAsRead = async function() {
    if (!this.wasRead) {
        return await this.update({
            wasRead: true,
            readAt: new Date()
        });
    }
    return this;
};

/**
 * Mark alert as unread
 */
BudgetAlert.prototype.markAsUnread = async function() {
    return await this.update({
        wasRead: false,
        readAt: null
    });
};

/**
 * Check if alert is recent (within last 24 hours)
 */
BudgetAlert.prototype.isRecent = function() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.sentAt >= dayAgo;
};

/**
 * Get alert age in hours
 */
BudgetAlert.prototype.getAgeInHours = function() {
    const now = new Date();
    const diff = now - this.sentAt;
    return Math.floor(diff / (1000 * 60 * 60));
};

// Class methods (static)

/**
 * Get all alerts for a user
 */
BudgetAlert.findByUser = async function(userId, options = {}) {
    return await this.findAll({
        where: { userId },
        order: [['sentAt', 'DESC']],
        ...options
    });
};

/**
 * Get unread alerts for a user
 */
BudgetAlert.findUnreadByUser = async function(userId, options = {}) {
    return await this.findAll({
        where: {
            userId,
            wasRead: false
        },
        order: [['sentAt', 'DESC']],
        ...options
    });
};

/**
 * Get alerts for a specific budget
 */
BudgetAlert.findByBudget = async function(budgetId, options = {}) {
    return await this.findAll({
        where: { budgetId },
        order: [['sentAt', 'DESC']],
        ...options
    });
};

/**
 * Get alerts by type
 */
BudgetAlert.findByType = async function(userId, alertType, options = {}) {
    return await this.findAll({
        where: {
            userId,
            alertType
        },
        order: [['sentAt', 'DESC']],
        ...options
    });
};

/**
 * Get recent alerts (last 7 days)
 */
BudgetAlert.findRecent = async function(userId, days = 7) {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    return await this.findAll({
        where: {
            userId,
            sentAt: { [Op.gte]: dateFrom }
        },
        order: [['sentAt', 'DESC']]
    });
};

/**
 * Get unread count for a user
 */
BudgetAlert.getUnreadCount = async function(userId) {
    return await this.count({
        where: {
            userId,
            wasRead: false
        }
    });
};

/**
 * Mark all alerts as read for a user
 */
BudgetAlert.markAllAsReadByUser = async function(userId) {
    return await this.update(
        {
            wasRead: true,
            readAt: new Date()
        },
        {
            where: {
                userId,
                wasRead: false
            }
        }
    );
};

/**
 * Delete old read alerts (cleanup)
 */
BudgetAlert.deleteOldReadAlerts = async function(daysOld = 90) {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysOld);

    return await this.destroy({
        where: {
            wasRead: true,
            readAt: { [Op.lt]: dateThreshold }
        }
    });
};

/**
 * Check if similar alert was sent recently (prevent spam)
 */
BudgetAlert.wasSimilarAlertSentRecently = async function(budgetId, alertType, threshold, hoursAgo = 24) {
    const dateThreshold = new Date();
    dateThreshold.setHours(dateThreshold.getHours() - hoursAgo);

    const where = {
        budgetId,
        alertType,
        sentAt: { [Op.gte]: dateThreshold }
    };

    if (threshold !== null && threshold !== undefined) {
        where.threshold = threshold;
    }

    const count = await this.count({ where });
    return count > 0;
};

/**
 * Create alert with validation
 */
BudgetAlert.createAlert = async function(alertData) {
    // Calculate percentage if not provided
    if (!alertData.percentage) {
        alertData.percentage = (parseFloat(alertData.currentSpending) / parseFloat(alertData.budgetAmount)) * 100;
    }

    // Check for duplicate recent alerts
    const isDuplicate = await this.wasSimilarAlertSentRecently(
        alertData.budgetId,
        alertData.alertType,
        alertData.threshold
    );

    if (isDuplicate) {
        throw new Error('Similar alert was sent recently. Skipping to avoid spam.');
    }

    return await this.create(alertData);
};

/**
 * Get alert statistics for a user
 */
BudgetAlert.getStatsByUser = async function(userId, days = 30) {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    const alerts = await this.findAll({
        where: {
            userId,
            sentAt: { [Op.gte]: dateFrom }
        },
        attributes: [
            'alertType',
            [sequelize.fn('COUNT', sequelize.col('alert_type')), 'count']
        ],
        group: ['alertType']
    });

    const stats = {
        total: 0,
        byType: {}
    };

    alerts.forEach(alert => {
        const type = alert.alertType;
        const count = parseInt(alert.get('count'));
        stats.byType[type] = count;
        stats.total += count;
    });

    return stats;
};

export default BudgetAlert;
