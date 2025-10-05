import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const NotificationPreference = sequelize.define('NotificationPreference', {
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
        unique: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    budgetAlerts: {
        field: 'budget_alerts',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    receiptProcessing: {
        field: 'receipt_processing',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    weeklyDigest: {
        field: 'weekly_digest',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    monthlyDigest: {
        field: 'monthly_digest',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    priceAlerts: {
        field: 'price_alerts',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    productRecommendations: {
        field: 'product_recommendations',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    digestFrequency: {
        field: 'digest_frequency',
        type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'none'),
        allowNull: false,
        defaultValue: 'weekly'
    },
    digestDay: {
        field: 'digest_day',
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Digest day must be between 0 (Sunday) and 6 (Saturday)'
            },
            max: {
                args: [6],
                msg: 'Digest day must be between 0 (Sunday) and 6 (Saturday)'
            }
        }
    },
    digestHour: {
        field: 'digest_hour',
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 18,
        validate: {
            min: {
                args: [0],
                msg: 'Digest hour must be between 0 and 23'
            },
            max: {
                args: [23],
                msg: 'Digest hour must be between 0 and 23'
            }
        }
    },
    channels: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: { push: true, email: false, inApp: true }
    },
    fcmToken: {
        field: 'fcm_token',
        type: DataTypes.STRING(500),
        allowNull: true
    },
    fcmTokenUpdatedAt: {
        field: 'fcm_token_updated_at',
        type: DataTypes.DATE,
        allowNull: true
    },
    deviceInfo: {
        field: 'device_info',
        type: DataTypes.JSONB,
        allowNull: true
    },
    timezone: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'UTC'
    },
    quietHoursEnabled: {
        field: 'quiet_hours_enabled',
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    quietHoursStart: {
        field: 'quiet_hours_start',
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Quiet hours start must be between 0 and 23'
            },
            max: {
                args: [23],
                msg: 'Quiet hours start must be between 0 and 23'
            }
        }
    },
    quietHoursEnd: {
        field: 'quiet_hours_end',
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: {
                args: [0],
                msg: 'Quiet hours end must be between 0 and 23'
            },
            max: {
                args: [23],
                msg: 'Quiet hours end must be between 0 and 23'
            }
        }
    }
}, {
    tableName: 'notification_preferences',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id'], unique: true },
        { fields: ['fcm_token'] },
        { fields: ['digest_frequency'] }
    ],
    hooks: {
        beforeUpdate: (pref) => {
            // Automatically update fcmTokenUpdatedAt when FCM token changes
            if (pref.changed('fcmToken')) {
                pref.fcmTokenUpdatedAt = new Date();
            }
        }
    }
});

// Instance methods

/**
 * Update FCM token
 */
NotificationPreference.prototype.updateFcmToken = async function(fcmToken, deviceInfo = null) {
    const updates = {
        fcmToken,
        fcmTokenUpdatedAt: new Date()
    };

    if (deviceInfo) {
        updates.deviceInfo = deviceInfo;
    }

    return await this.update(updates);
};

/**
 * Remove FCM token (logout or revoke)
 */
NotificationPreference.prototype.removeFcmToken = async function() {
    return await this.update({
        fcmToken: null,
        fcmTokenUpdatedAt: new Date()
    });
};

/**
 * Check if push notifications are enabled
 */
NotificationPreference.prototype.isPushEnabled = function() {
    return this.channels?.push === true && this.fcmToken !== null;
};

/**
 * Check if email notifications are enabled
 */
NotificationPreference.prototype.isEmailEnabled = function() {
    return this.channels?.email === true;
};

/**
 * Check if in-app notifications are enabled
 */
NotificationPreference.prototype.isInAppEnabled = function() {
    return this.channels?.inApp === true;
};

/**
 * Check if currently in quiet hours
 */
NotificationPreference.prototype.isInQuietHours = function() {
    if (!this.quietHoursEnabled || this.quietHoursStart === null || this.quietHoursEnd === null) {
        return false;
    }

    const now = new Date();
    const currentHour = now.getHours();

    if (this.quietHoursStart < this.quietHoursEnd) {
        // Normal range (e.g., 22:00 to 07:00 next day)
        return currentHour >= this.quietHoursStart && currentHour < this.quietHoursEnd;
    } else {
        // Overnight range (e.g., 22:00 to 07:00)
        return currentHour >= this.quietHoursStart || currentHour < this.quietHoursEnd;
    }
};

/**
 * Check if specific notification type is enabled
 */
NotificationPreference.prototype.isNotificationEnabled = function(notificationType) {
    const typeMap = {
        budget: 'budgetAlerts',
        receipt: 'receiptProcessing',
        price: 'priceAlerts',
        recommendation: 'productRecommendations'
    };

    const field = typeMap[notificationType];
    return field ? this[field] : false;
};

/**
 * Get enabled channels for notification
 */
NotificationPreference.prototype.getEnabledChannels = function() {
    const enabled = [];

    if (this.isPushEnabled()) enabled.push('push');
    if (this.isEmailEnabled()) enabled.push('email');
    if (this.isInAppEnabled()) enabled.push('inApp');

    return enabled;
};

/**
 * Should send digest today?
 */
NotificationPreference.prototype.shouldSendDigestToday = function() {
    if (this.digestFrequency === 'none') {
        return false;
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const currentHour = now.getHours();

    if (this.digestFrequency === 'daily') {
        return currentHour === this.digestHour;
    }

    if (this.digestFrequency === 'weekly') {
        return currentDay === this.digestDay && currentHour === this.digestHour;
    }

    if (this.digestFrequency === 'monthly') {
        const currentDate = now.getDate();
        return currentDate === 1 && currentHour === this.digestHour; // First day of month
    }

    return false;
};

/**
 * Update notification channels
 */
NotificationPreference.prototype.updateChannels = async function(channels) {
    return await this.update({ channels });
};

/**
 * Enable/disable quiet hours
 */
NotificationPreference.prototype.setQuietHours = async function(enabled, start = null, end = null) {
    const updates = { quietHoursEnabled: enabled };

    if (enabled) {
        if (start !== null) updates.quietHoursStart = start;
        if (end !== null) updates.quietHoursEnd = end;
    }

    return await this.update(updates);
};

// Class methods (static)

/**
 * Get preferences by user ID
 */
NotificationPreference.findByUserId = async function(userId) {
    return await this.findOne({ where: { userId } });
};

/**
 * Create or get preferences for user
 */
NotificationPreference.getOrCreate = async function(userId) {
    const [preferences, created] = await this.findOrCreate({
        where: { userId },
        defaults: {
            userId,
            budgetAlerts: true,
            receiptProcessing: true,
            weeklyDigest: true,
            monthlyDigest: true,
            priceAlerts: true,
            productRecommendations: false,
            digestFrequency: 'weekly',
            digestDay: 0, // Sunday
            digestHour: 18, // 6 PM
            channels: { push: true, email: false, inApp: true },
            timezone: 'UTC',
            quietHoursEnabled: false
        }
    });

    return preferences;
};

/**
 * Get all users with push enabled
 */
NotificationPreference.findUsersWithPushEnabled = async function() {
    return await this.findAll({
        where: {
            fcmToken: { [Op.ne]: null }
        },
        include: [{ model: sequelize.models.User, as: 'user' }]
    });
};

/**
 * Get users for digest sending
 */
NotificationPreference.findUsersForDigest = async function(frequency, day = null) {
    const now = new Date();
    const currentHour = now.getHours();

    const where = {
        digestFrequency: frequency,
        digestHour: currentHour
    };

    if (frequency === 'weekly' && day !== null) {
        where.digestDay = day;
    }

    if (frequency === 'monthly') {
        const currentDate = now.getDate();
        if (currentDate !== 1) return []; // Only send on first day of month
    }

    // Check if weekly or monthly digest is enabled
    if (frequency === 'weekly') {
        where.weeklyDigest = true;
    } else if (frequency === 'monthly') {
        where.monthlyDigest = true;
    }

    return await this.findAll({
        where,
        include: [{ model: sequelize.models.User, as: 'user' }]
    });
};

/**
 * Clean up old FCM tokens (inactive for X days)
 */
NotificationPreference.cleanupInactiveFcmTokens = async function(daysInactive = 90) {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysInactive);

    return await this.update(
        {
            fcmToken: null,
            fcmTokenUpdatedAt: null
        },
        {
            where: {
                fcmToken: { [Op.ne]: null },
                fcmTokenUpdatedAt: { [Op.lt]: dateThreshold }
            }
        }
    );
};

/**
 * Get users not in quiet hours with specific notification enabled
 */
NotificationPreference.findUsersForNotification = async function(notificationType) {
    const typeMap = {
        budget: 'budgetAlerts',
        receipt: 'receiptProcessing',
        price: 'priceAlerts',
        recommendation: 'productRecommendations'
    };

    const field = typeMap[notificationType];
    if (!field) {
        throw new Error(`Invalid notification type: ${notificationType}`);
    }

    const now = new Date();
    const currentHour = now.getHours();

    // Find users with notification enabled, not in quiet hours
    const preferences = await this.findAll({
        where: {
            [field]: true
        },
        include: [{ model: sequelize.models.User, as: 'user' }]
    });

    // Filter out users currently in quiet hours
    return preferences.filter(pref => !pref.isInQuietHours());
};

export default NotificationPreference;
