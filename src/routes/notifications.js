import { Router } from 'express';
import { body } from 'express-validator';
import {
    getPreferences,
    updatePreferences,
    registerFCMToken,
    removeFCMToken,
    updateChannels,
    setQuietHours,
    updateDigestSettings,
    sendTestNotification,
    getFCMStatus
} from '../controllers/notificationController.js';
import { authenticate } from '../middlewares/auth.js';
import { validate, sanitizeInput } from '../middlewares/validation.js';

const router = Router();

// Apply authentication and sanitization to all routes
router.use(authenticate);
router.use(sanitizeInput);

// Validation schemas
const fcmTokenValidation = [
    body('fcmToken')
        .trim()
        .notEmpty()
        .withMessage('FCM token is required')
        .isLength({ min: 10, max: 500 })
        .withMessage('FCM token must be between 10 and 500 characters'),
    body('deviceInfo')
        .optional()
        .isObject()
        .withMessage('Device info must be an object')
];

const channelsValidation = [
    body('channels')
        .isObject()
        .withMessage('Channels must be an object')
        .custom((value) => {
            const validKeys = ['push', 'email', 'inApp'];
            const keys = Object.keys(value);
            if (!keys.every(k => validKeys.includes(k))) {
                throw new Error('Invalid channel keys. Must be push, email, or inApp');
            }
            if (!keys.every(k => typeof value[k] === 'boolean')) {
                throw new Error('Channel values must be boolean');
            }
            return true;
        })
];

const quietHoursValidation = [
    body('enabled')
        .isBoolean()
        .withMessage('Enabled must be boolean'),
    body('start')
        .optional()
        .isInt({ min: 0, max: 23 })
        .withMessage('Start hour must be between 0 and 23'),
    body('end')
        .optional()
        .isInt({ min: 0, max: 23 })
        .withMessage('End hour must be between 0 and 23')
];

const digestValidation = [
    body('frequency')
        .optional()
        .isIn(['daily', 'weekly', 'monthly', 'none'])
        .withMessage('Frequency must be daily, weekly, monthly, or none'),
    body('day')
        .optional()
        .isInt({ min: 0, max: 6 })
        .withMessage('Day must be between 0 (Sunday) and 6 (Saturday)'),
    body('hour')
        .optional()
        .isInt({ min: 0, max: 23 })
        .withMessage('Hour must be between 0 and 23'),
    body('weeklyEnabled')
        .optional()
        .isBoolean()
        .withMessage('Weekly enabled must be boolean'),
    body('monthlyEnabled')
        .optional()
        .isBoolean()
        .withMessage('Monthly enabled must be boolean')
];

const testNotificationValidation = [
    body('channel')
        .optional()
        .isIn(['push', 'email', 'all'])
        .withMessage('Channel must be push, email, or all')
];

// Routes

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get user notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User notification preferences
 */
router.get('/preferences', getPreferences);

/**
 * @swagger
 * /api/notifications/preferences:
 *   put:
 *     summary: Update notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               budgetAlerts:
 *                 type: boolean
 *               receiptProcessing:
 *                 type: boolean
 *               weeklyDigest:
 *                 type: boolean
 *               monthlyDigest:
 *                 type: boolean
 *               priceAlerts:
 *                 type: boolean
 *               productRecommendations:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 */
router.put('/preferences', updatePreferences);

/**
 * @swagger
 * /api/notifications/fcm-token:
 *   post:
 *     summary: Register FCM token for push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fcmToken
 *             properties:
 *               fcmToken:
 *                 type: string
 *                 example: "dQw4w9WgXcQ:APA91bF..."
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   platform:
 *                     type: string
 *                     example: "android"
 *                   model:
 *                     type: string
 *                     example: "Pixel 6"
 *                   osVersion:
 *                     type: string
 *                     example: "13"
 *                   appVersion:
 *                     type: string
 *                     example: "1.0.0"
 *     responses:
 *       200:
 *         description: FCM token registered successfully
 */
router.post('/fcm-token', fcmTokenValidation, validate, registerFCMToken);

/**
 * @swagger
 * /api/notifications/fcm-token:
 *   delete:
 *     summary: Remove FCM token (logout from push notifications)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: FCM token removed successfully
 */
router.delete('/fcm-token', removeFCMToken);

/**
 * @swagger
 * /api/notifications/channels:
 *   put:
 *     summary: Update notification channels
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channels
 *             properties:
 *               channels:
 *                 type: object
 *                 properties:
 *                   push:
 *                     type: boolean
 *                   email:
 *                     type: boolean
 *                   inApp:
 *                     type: boolean
 *                 example:
 *                   push: true
 *                   email: false
 *                   inApp: true
 *     responses:
 *       200:
 *         description: Channels updated successfully
 */
router.put('/channels', channelsValidation, validate, updateChannels);

/**
 * @swagger
 * /api/notifications/quiet-hours:
 *   put:
 *     summary: Set quiet hours (do not disturb)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *               start:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 23
 *                 example: 22
 *               end:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 23
 *                 example: 7
 *     responses:
 *       200:
 *         description: Quiet hours updated successfully
 */
router.put('/quiet-hours', quietHoursValidation, validate, setQuietHours);

/**
 * @swagger
 * /api/notifications/digest:
 *   put:
 *     summary: Update digest settings
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               frequency:
 *                 type: string
 *                 enum: [daily, weekly, monthly, none]
 *               day:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 6
 *                 description: Day of week (0=Sunday, 6=Saturday)
 *               hour:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 23
 *               weeklyEnabled:
 *                 type: boolean
 *               monthlyEnabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Digest settings updated successfully
 */
router.put('/digest', digestValidation, validate, updateDigestSettings);

/**
 * @swagger
 * /api/notifications/test:
 *   post:
 *     summary: Send test notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channel:
 *                 type: string
 *                 enum: [push, email, all]
 *                 default: all
 *     responses:
 *       200:
 *         description: Test notification sent
 */
router.post('/test', testNotificationValidation, validate, sendTestNotification);

/**
 * @swagger
 * /api/notifications/fcm/status:
 *   get:
 *     summary: Check FCM service status
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: FCM service status
 */
router.get('/fcm/status', getFCMStatus);

export default router;
