import NotificationPreference from '../models/NotificationPreference.js';
import { asyncHandler } from '../utils/errors.js';
import { NotFoundError } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import notificationService from '../services/notificationService.js';

/**
 * GET /api/notifications/preferences
 * Get user's notification preferences
 */
export const getPreferences = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const preferences = await NotificationPreference.getOrCreate(userId);

    res.json({
        status: 'success',
        data: { preferences }
    });
});

/**
 * PUT /api/notifications/preferences
 * Update user's notification preferences
 */
export const updatePreferences = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const updates = req.body;

    let preferences = await NotificationPreference.findByUserId(userId);

    if (!preferences) {
        preferences = await NotificationPreference.create({
            userId,
            ...updates
        });
    } else {
        // Don't allow changing userId or fcmToken via this endpoint
        delete updates.userId;
        delete updates.fcmToken;
        delete updates.fcmTokenUpdatedAt;

        await preferences.update(updates);
    }

    log.info(`Notification preferences updated for user ${userId}`);

    res.json({
        status: 'success',
        message: req.t('notifications.preferences_updated'),
        data: { preferences }
    });
});

/**
 * POST /api/notifications/fcm-token
 * Register or update FCM token for push notifications
 */
export const registerFCMToken = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { fcmToken, deviceInfo } = req.body;

    if (!fcmToken) {
        throw new ValidationError('FCM token is required');
    }

    let preferences = await NotificationPreference.findByUserId(userId);

    if (!preferences) {
        preferences = await NotificationPreference.create({
            userId,
            fcmToken,
            deviceInfo
        });
    } else {
        await preferences.updateFcmToken(fcmToken, deviceInfo);
    }

    log.info(`FCM token registered for user ${userId}`, {
        platform: deviceInfo?.platform,
        tokenPrefix: fcmToken.substring(0, 20)
    });

    res.json({
        status: 'success',
        message: req.t('notifications.fcm_token_registered'),
        data: { preferences }
    });
});

/**
 * DELETE /api/notifications/fcm-token
 * Remove FCM token (logout from push notifications)
 */
export const removeFCMToken = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const preferences = await NotificationPreference.findByUserId(userId);

    if (preferences) {
        await preferences.removeFcmToken();
    }

    log.info(`FCM token removed for user ${userId}`);

    res.json({
        status: 'success',
        message: req.t('notifications.fcm_token_removed')
    });
});

/**
 * PUT /api/notifications/channels
 * Update notification channels (push/email/inApp)
 */
export const updateChannels = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { channels } = req.body;

    if (!channels || typeof channels !== 'object') {
        throw new ValidationError('Channels object is required');
    }

    let preferences = await NotificationPreference.findByUserId(userId);

    if (!preferences) {
        preferences = await NotificationPreference.create({
            userId,
            channels
        });
    } else {
        await preferences.updateChannels(channels);
    }

    log.info(`Notification channels updated for user ${userId}`, { channels });

    res.json({
        status: 'success',
        message: req.t('notifications.channels_updated'),
        data: { preferences }
    });
});

/**
 * PUT /api/notifications/quiet-hours
 * Set quiet hours (do not disturb)
 */
export const setQuietHours = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { enabled, start, end } = req.body;

    let preferences = await NotificationPreference.findByUserId(userId);

    if (!preferences) {
        preferences = await NotificationPreference.create({
            userId,
            quietHoursEnabled: enabled,
            quietHoursStart: start,
            quietHoursEnd: end
        });
    } else {
        await preferences.setQuietHours(enabled, start, end);
    }

    log.info(`Quiet hours ${enabled ? 'enabled' : 'disabled'} for user ${userId}`, {
        start,
        end
    });

    res.json({
        status: 'success',
        message: req.t('notifications.quiet_hours_updated'),
        data: { preferences }
    });
});

/**
 * PUT /api/notifications/digest
 * Update digest settings
 */
export const updateDigestSettings = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { frequency, day, hour, weeklyEnabled, monthlyEnabled } = req.body;

    const updates = {};
    if (frequency !== undefined) updates.digestFrequency = frequency;
    if (day !== undefined) updates.digestDay = day;
    if (hour !== undefined) updates.digestHour = hour;
    if (weeklyEnabled !== undefined) updates.weeklyDigest = weeklyEnabled;
    if (monthlyEnabled !== undefined) updates.monthlyDigest = monthlyEnabled;

    let preferences = await NotificationPreference.findByUserId(userId);

    if (!preferences) {
        preferences = await NotificationPreference.create({
            userId,
            ...updates
        });
    } else {
        await preferences.update(updates);
    }

    log.info(`Digest settings updated for user ${userId}`, updates);

    res.json({
        status: 'success',
        message: req.t('notifications.digest_settings_updated'),
        data: { preferences }
    });
});

/**
 * POST /api/notifications/test
 * Send test notification
 */
export const sendTestNotification = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { channel } = req.body;

    const testNotification = {
        title: '🔔 Test Notification',
        body: 'This is a test notification from TallyLens. If you received this, your notifications are working correctly!',
        data: {
            type: 'test',
            timestamp: new Date().toISOString()
        },
        channelId: 'test'
    };

    let result;

    if (channel === 'push') {
        result = await notificationService.sendPushNotification(userId, testNotification);
    } else if (channel === 'email') {
        result = await notificationService.sendEmailNotification(userId, {
            subject: testNotification.title,
            template: 'test-notification',
            data: { message: testNotification.body }
        });
    } else {
        result = await notificationService.sendNotification(userId, testNotification);
    }

    res.json({
        status: 'success',
        message: req.t('notifications.test_sent'),
        data: result
    });
});

/**
 * GET /api/notifications/fcm/status
 * Check FCM service status
 */
export const getFCMStatus = asyncHandler(async (req, res) => {
    const status = await notificationService.testFCMConnection();

    res.json({
        status: 'success',
        data: status
    });
});

export default {
    getPreferences,
    updatePreferences,
    registerFCMToken,
    removeFCMToken,
    updateChannels,
    setQuietHours,
    updateDigestSettings,
    sendTestNotification,
    getFCMStatus
};
