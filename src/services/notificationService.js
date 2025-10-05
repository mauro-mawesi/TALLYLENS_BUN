import NotificationPreference from '../models/NotificationPreference.js';
import BudgetAlert from '../models/BudgetAlert.js';
import User from '../models/User.js';
import { log } from '../utils/logger.js';
import queueService from './queueService.js';
import config from '../config/environment.js';

// Firebase Admin SDK (lazy loaded)
let admin = null;

/**
 * Initialize Firebase Admin SDK
 */
async function initializeFirebase() {
    if (admin) return admin;

    try {
        // Dynamically import firebase-admin if available
        const firebaseAdmin = await import('firebase-admin');
        admin = firebaseAdmin;

        // Initialize Firebase with service account
        if (!admin.apps.length && config.firebase?.serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(config.firebase.serviceAccount)
            });
            log.info('Firebase Admin SDK initialized successfully');
        }

        return admin;
    } catch (error) {
        log.warn('Firebase Admin SDK not available. Push notifications will be disabled.', error.message);
        return null;
    }
}

/**
 * Send push notification via FCM
 */
export async function sendPushNotification(userId, notification) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);

        if (!preferences || !preferences.isPushEnabled() || preferences.isInQuietHours()) {
            log.debug(`Push notification skipped for user ${userId}: disabled or quiet hours`);
            return { sent: false, reason: 'disabled_or_quiet_hours' };
        }

        const fcmToken = preferences.fcmToken;
        if (!fcmToken) {
            log.debug(`No FCM token for user ${userId}`);
            return { sent: false, reason: 'no_fcm_token' };
        }

        // Initialize Firebase if needed
        const firebase = await initializeFirebase();
        if (!firebase) {
            log.warn('Firebase not available, cannot send push notification');
            return { sent: false, reason: 'firebase_not_available' };
        }

        const message = {
            token: fcmToken,
            notification: {
                title: notification.title,
                body: notification.body
            },
            data: notification.data || {},
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: notification.channelId || 'budget_alerts'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: notification.badge || 1
                    }
                }
            }
        };

        const response = await firebase.messaging().send(message);
        log.info(`Push notification sent to user ${userId}: ${response}`);

        return { sent: true, messageId: response };
    } catch (error) {
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            // Remove invalid FCM token
            log.warn(`Invalid FCM token for user ${userId}, removing...`);
            const preferences = await NotificationPreference.findByUserId(userId);
            if (preferences) {
                await preferences.removeFcmToken();
            }
        } else {
            log.error(`Error sending push notification to user ${userId}:`, error);
        }

        return { sent: false, error: error.message };
    }
}

/**
 * Send email notification via queue
 */
export async function sendEmailNotification(userId, emailData) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);

        if (!preferences || !preferences.isEmailEnabled()) {
            log.debug(`Email notification skipped for user ${userId}: disabled`);
            return { sent: false, reason: 'disabled' };
        }

        const user = await User.findByPk(userId);
        if (!user || !user.email) {
            log.warn(`No email found for user ${userId}`);
            return { sent: false, reason: 'no_email' };
        }

        // Queue email for sending
        await queueService.addEmailJob({
            to: user.email,
            subject: emailData.subject,
            template: emailData.template || 'budget-alert',
            data: {
                userName: user.firstName || user.username,
                ...emailData.data
            }
        });

        log.info(`Email queued for user ${userId}: ${emailData.subject}`);

        return { sent: true, queued: true };
    } catch (error) {
        log.error(`Error sending email to user ${userId}:`, error);
        return { sent: false, error: error.message };
    }
}

/**
 * Create in-app notification
 */
export async function createInAppNotification(userId, notificationData) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);

        if (!preferences || !preferences.isInAppEnabled()) {
            log.debug(`In-app notification skipped for user ${userId}: disabled`);
            return { created: false, reason: 'disabled' };
        }

        // In-app notifications are stored as BudgetAlerts with wasRead=false
        // They're already created by budgetService, so this is mainly for other types
        log.debug(`In-app notification ready for user ${userId}`);

        return { created: true };
    } catch (error) {
        log.error(`Error creating in-app notification for user ${userId}:`, error);
        return { created: false, error: error.message };
    }
}

/**
 * Send notification via all enabled channels
 */
export async function sendNotification(userId, notification, options = {}) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);
        if (!preferences) {
            log.warn(`No notification preferences found for user ${userId}`);
            return { sent: false, reason: 'no_preferences' };
        }

        // Check if notification type is enabled
        if (options.notificationType && !preferences.isNotificationEnabled(options.notificationType)) {
            log.debug(`Notification type ${options.notificationType} disabled for user ${userId}`);
            return { sent: false, reason: 'notification_type_disabled' };
        }

        const enabledChannels = preferences.getEnabledChannels();
        const results = {
            userId,
            channels: {},
            success: false
        };

        // Send via each enabled channel
        if (enabledChannels.includes('push')) {
            results.channels.push = await sendPushNotification(userId, {
                title: notification.title,
                body: notification.body,
                data: notification.data,
                channelId: notification.channelId,
                badge: notification.badge
            });
        }

        if (enabledChannels.includes('email')) {
            results.channels.email = await sendEmailNotification(userId, {
                subject: notification.title,
                template: notification.emailTemplate || 'budget-alert',
                data: notification.data
            });
        }

        if (enabledChannels.includes('inApp')) {
            results.channels.inApp = await createInAppNotification(userId, notification);
        }

        // Mark as success if at least one channel succeeded
        results.success = Object.values(results.channels).some(r => r.sent || r.created);

        log.info(`Notification sent to user ${userId} via ${enabledChannels.join(', ')}`);

        return results;
    } catch (error) {
        log.error(`Error sending notification to user ${userId}:`, error);
        throw error;
    }
}

/**
 * Send budget alert notification
 */
export async function sendBudgetAlertNotification(budgetAlert) {
    try {
        const alert = await BudgetAlert.findByPk(budgetAlert.id, {
            include: [
                { model: User, as: 'user' }
            ]
        });

        if (!alert) {
            throw new Error('Budget alert not found');
        }

        const notification = {
            title: getAlertTitle(alert.alertType),
            body: alert.message,
            data: {
                type: 'budget_alert',
                alertId: alert.id,
                budgetId: alert.budgetId,
                alertType: alert.alertType,
                percentage: alert.percentage.toString()
            },
            channelId: 'budget_alerts',
            badge: await BudgetAlert.getUnreadCount(alert.userId)
        };

        const result = await sendNotification(alert.userId, notification, {
            notificationType: 'budget'
        });

        // Update alert with channels used
        const sentChannels = Object.keys(result.channels).filter(ch =>
            result.channels[ch].sent || result.channels[ch].created
        );

        if (sentChannels.length > 0) {
            await alert.update({ sentVia: sentChannels });
        }

        return result;
    } catch (error) {
        log.error(`Error sending budget alert notification:`, error);
        throw error;
    }
}

/**
 * Send weekly digest
 */
export async function sendWeeklyDigest(userId) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);
        if (!preferences || !preferences.weeklyDigest) {
            return { sent: false, reason: 'digest_disabled' };
        }

        const user = await User.findByPk(userId);

        // Get user's budget summary for the week
        const { getUserBudgetsSummary } = await import('./budgetService.js');
        const summary = await getUserBudgetsSummary(userId);

        const notification = {
            title: '📊 Weekly Spending Summary',
            body: `You have ${summary.budgets.length} active budgets. ${summary.summary.critical} need attention.`,
            data: {
                type: 'weekly_digest',
                budgetCount: summary.budgets.length.toString(),
                criticalCount: summary.summary.critical.toString()
            },
            emailTemplate: 'weekly-digest',
            channelId: 'digests'
        };

        notification.data.budgets = JSON.stringify(summary.budgets);

        return await sendNotification(userId, notification);
    } catch (error) {
        log.error(`Error sending weekly digest to user ${userId}:`, error);
        throw error;
    }
}

/**
 * Send monthly digest
 */
export async function sendMonthlyDigest(userId) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);
        if (!preferences || !preferences.monthlyDigest) {
            return { sent: false, reason: 'digest_disabled' };
        }

        const user = await User.findByPk(userId);

        // Get user's budget summary for the month
        const { getUserBudgetsSummary } = await import('./budgetService.js');
        const summary = await getUserBudgetsSummary(userId);

        const totalSpent = summary.budgets.reduce((sum, b) => sum + parseFloat(b.currentSpending), 0);
        const totalBudget = summary.budgets.reduce((sum, b) => sum + parseFloat(b.totalBudget), 0);

        const notification = {
            title: '📈 Monthly Financial Report',
            body: `Total spent: ${totalSpent.toFixed(2)}. ${summary.summary.exceeded} budgets exceeded.`,
            data: {
                type: 'monthly_digest',
                totalSpent: totalSpent.toFixed(2),
                totalBudget: totalBudget.toFixed(2),
                exceededCount: summary.summary.exceeded.toString()
            },
            emailTemplate: 'monthly-digest',
            channelId: 'digests'
        };

        notification.data.budgets = JSON.stringify(summary.budgets);

        return await sendNotification(userId, notification);
    } catch (error) {
        log.error(`Error sending monthly digest to user ${userId}:`, error);
        throw error;
    }
}

/**
 * Send receipt processing notification
 */
export async function sendReceiptProcessedNotification(userId, receipt) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);
        if (!preferences || !preferences.receiptProcessing) {
            return { sent: false, reason: 'notification_disabled' };
        }

        const notification = {
            title: '✅ Receipt Processed',
            body: `Your receipt from ${receipt.merchantName || 'store'} has been processed (${receipt.amount} ${receipt.currency}).`,
            data: {
                type: 'receipt_processed',
                receiptId: receipt.id,
                amount: receipt.amount.toString(),
                merchantName: receipt.merchantName || ''
            },
            channelId: 'receipts'
        };

        return await sendNotification(userId, notification, {
            notificationType: 'receipt'
        });
    } catch (error) {
        log.error(`Error sending receipt processed notification:`, error);
        throw error;
    }
}

/**
 * Send price alert notification
 */
export async function sendPriceAlertNotification(userId, priceAlert) {
    try {
        const preferences = await NotificationPreference.findByUserId(userId);
        if (!preferences || !preferences.priceAlerts) {
            return { sent: false, reason: 'notification_disabled' };
        }

        const notification = {
            title: '💰 Price Alert',
            body: priceAlert.message,
            data: {
                type: 'price_alert',
                productId: priceAlert.productId,
                oldPrice: priceAlert.oldPrice.toString(),
                newPrice: priceAlert.newPrice.toString()
            },
            channelId: 'price_alerts'
        };

        return await sendNotification(userId, notification, {
            notificationType: 'price'
        });
    } catch (error) {
        log.error(`Error sending price alert notification:`, error);
        throw error;
    }
}

/**
 * Batch send notifications to multiple users
 */
export async function batchSendNotifications(notifications) {
    try {
        const results = await Promise.allSettled(
            notifications.map(notif =>
                sendNotification(notif.userId, notif.notification, notif.options)
            )
        );

        const summary = {
            total: notifications.length,
            succeeded: results.filter(r => r.status === 'fulfilled').length,
            failed: results.filter(r => r.status === 'rejected').length
        };

        log.info(`Batch notifications sent: ${summary.succeeded}/${summary.total} succeeded`);

        return { results, summary };
    } catch (error) {
        log.error('Error in batch send notifications:', error);
        throw error;
    }
}

/**
 * Get alert title by type
 */
function getAlertTitle(alertType) {
    const titles = {
        threshold: '⚠️ Budget Alert',
        predictive: '🔮 Budget Prediction',
        comparative: '📊 Spending Comparison',
        digest: '📈 Spending Summary',
        exceeded: '🚨 Budget Exceeded'
    };

    return titles[alertType] || '💰 Budget Notification';
}

/**
 * Test FCM connection
 */
export async function testFCMConnection() {
    try {
        const firebase = await initializeFirebase();
        if (!firebase) {
            return { available: false, message: 'Firebase Admin SDK not available' };
        }

        return { available: true, message: 'Firebase Admin SDK is ready' };
    } catch (error) {
        return { available: false, message: error.message };
    }
}

export default {
    sendPushNotification,
    sendEmailNotification,
    createInAppNotification,
    sendNotification,
    sendBudgetAlertNotification,
    sendWeeklyDigest,
    sendMonthlyDigest,
    sendReceiptProcessedNotification,
    sendPriceAlertNotification,
    batchSendNotifications,
    testFCMConnection
};
