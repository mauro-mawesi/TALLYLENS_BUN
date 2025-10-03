import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import Receipt from '../models/Receipt.js';
import { log } from '../utils/logger.js';

/**
 * Badge definitions with progressive tiers
 * Each badge has multiple levels that unlock as users progress
 */
const BADGE_DEFINITIONS = {
    // Receipts-based badges
    digitizer: {
        icon: 'receipt_long',
        tiers: [
            { threshold: 1, level: 'bronze', key: 'digitizer_1' },
            { threshold: 10, level: 'silver', key: 'digitizer_10' },
            { threshold: 50, level: 'gold', key: 'digitizer_50' },
            { threshold: 100, level: 'platinum', key: 'digitizer_100' },
            { threshold: 500, level: 'diamond', key: 'digitizer_500' }
        ]
    },

    // Unique products tracked
    collector: {
        icon: 'inventory_2',
        tiers: [
            { threshold: 10, level: 'bronze', key: 'collector_10' },
            { threshold: 50, level: 'silver', key: 'collector_50' },
            { threshold: 100, level: 'gold', key: 'collector_100' },
            { threshold: 250, level: 'platinum', key: 'collector_250' },
            { threshold: 500, level: 'diamond', key: 'collector_500' }
        ]
    },

    // Unique merchants visited
    explorer: {
        icon: 'explore',
        tiers: [
            { threshold: 3, level: 'bronze', key: 'explorer_3' },
            { threshold: 5, level: 'silver', key: 'explorer_5' },
            { threshold: 10, level: 'gold', key: 'explorer_10' },
            { threshold: 20, level: 'platinum', key: 'explorer_20' },
            { threshold: 50, level: 'diamond', key: 'explorer_50' }
        ]
    },

    // Money saved through discounts
    saver: {
        icon: 'savings',
        tiers: [
            { threshold: 10, level: 'bronze', key: 'saver_10' },
            { threshold: 50, level: 'silver', key: 'saver_50' },
            { threshold: 100, level: 'gold', key: 'saver_100' },
            { threshold: 250, level: 'platinum', key: 'saver_250' },
            { threshold: 500, level: 'diamond', key: 'saver_500' }
        ]
    },

    // Days using the app
    veteran: {
        icon: 'military_tech',
        tiers: [
            { threshold: 7, level: 'bronze', key: 'veteran_7' },
            { threshold: 30, level: 'silver', key: 'veteran_30' },
            { threshold: 90, level: 'gold', key: 'veteran_90' },
            { threshold: 180, level: 'platinum', key: 'veteran_180' },
            { threshold: 365, level: 'diamond', key: 'veteran_365' }
        ]
    },

    // Current streak (consecutive days with receipts)
    streak: {
        icon: 'local_fire_department',
        tiers: [
            { threshold: 3, level: 'bronze', key: 'streak_3' },
            { threshold: 7, level: 'silver', key: 'streak_7' },
            { threshold: 14, level: 'gold', key: 'streak_14' },
            { threshold: 30, level: 'platinum', key: 'streak_30' },
            { threshold: 60, level: 'diamond', key: 'streak_60' }
        ]
    },

    // Total spending tracked
    tracker: {
        icon: 'monitoring',
        tiers: [
            { threshold: 100, level: 'bronze', key: 'tracker_100' },
            { threshold: 500, level: 'silver', key: 'tracker_500' },
            { threshold: 1000, level: 'gold', key: 'tracker_1000' },
            { threshold: 5000, level: 'platinum', key: 'tracker_5000' },
            { threshold: 10000, level: 'diamond', key: 'tracker_10000' }
        ]
    }
};

/**
 * Calculate user badges based on their activity
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of earned badges
 */
export async function calculateUserBadges(userId) {
    try {
        // Get all-time user metrics
        const metrics = await getUserMetrics(userId);

        const badges = [];

        // Calculate digitizer badges (receipts scanned)
        const digitizerBadge = calculateTieredBadge(
            'digitizer',
            metrics.totalReceipts,
            BADGE_DEFINITIONS.digitizer
        );
        if (digitizerBadge) badges.push(digitizerBadge);

        // Calculate collector badges (unique products)
        const collectorBadge = calculateTieredBadge(
            'collector',
            metrics.uniqueProducts,
            BADGE_DEFINITIONS.collector
        );
        if (collectorBadge) badges.push(collectorBadge);

        // Calculate explorer badges (unique merchants)
        const explorerBadge = calculateTieredBadge(
            'explorer',
            metrics.uniqueMerchants,
            BADGE_DEFINITIONS.explorer
        );
        if (explorerBadge) badges.push(explorerBadge);

        // Calculate saver badges (money saved)
        const saverBadge = calculateTieredBadge(
            'saver',
            metrics.totalSaved,
            BADGE_DEFINITIONS.saver
        );
        if (saverBadge) badges.push(saverBadge);

        // Calculate veteran badges (days since first receipt)
        const veteranBadge = calculateTieredBadge(
            'veteran',
            metrics.daysSinceFirst,
            BADGE_DEFINITIONS.veteran
        );
        if (veteranBadge) badges.push(veteranBadge);

        // Calculate streak badge (current consecutive days)
        const streakBadge = calculateTieredBadge(
            'streak',
            metrics.currentStreak,
            BADGE_DEFINITIONS.streak
        );
        if (streakBadge) badges.push(streakBadge);

        // Calculate tracker badges (total money tracked)
        const trackerBadge = calculateTieredBadge(
            'tracker',
            metrics.totalSpent,
            BADGE_DEFINITIONS.tracker
        );
        if (trackerBadge) badges.push(trackerBadge);

        return badges;
    } catch (error) {
        log.error('Error calculating user badges', { userId, error: error.message });
        return [];
    }
}

/**
 * Get comprehensive user metrics for badge calculation
 */
async function getUserMetrics(userId) {
    // Total receipts
    const totalReceipts = await Receipt.count({
        where: { userId }
    });

    // Unique products
    const uniqueProductsResult = await sequelize.query(`
        SELECT COUNT(DISTINCT ri.product_id) as count
        FROM receipt_items ri
        INNER JOIN receipts r ON ri.receipt_id = r.id
        WHERE r.user_id = :userId
        AND ri.product_id IS NOT NULL
    `, {
        replacements: { userId },
        type: sequelize.QueryTypes.SELECT
    });
    const uniqueProducts = parseInt(uniqueProductsResult[0]?.count || 0);

    // Unique merchants
    const uniqueMerchantsResult = await sequelize.query(`
        SELECT COUNT(DISTINCT merchant_name) as count
        FROM receipts
        WHERE user_id = :userId
        AND merchant_name IS NOT NULL
    `, {
        replacements: { userId },
        type: sequelize.QueryTypes.SELECT
    });
    const uniqueMerchants = parseInt(uniqueMerchantsResult[0]?.count || 0);

    // Total money saved (from discounts) - with proper JSONB type checking
    const totalSavedResult = await sequelize.query(`
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN jsonb_typeof(discount_info->'amount') = 'number'
                    THEN (discount_info->>'amount')::numeric
                    ELSE 0
                END
            ), 0
        ) as total
        FROM receipts
        WHERE user_id = :userId
        AND discount_info IS NOT NULL
    `, {
        replacements: { userId },
        type: sequelize.QueryTypes.SELECT
    });
    const totalSaved = parseFloat(totalSavedResult[0]?.total || 0);

    // Total spent
    const totalSpentResult = await Receipt.findOne({
        where: { userId },
        attributes: [
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']
        ]
    });
    const totalSpent = parseFloat(totalSpentResult?.dataValues?.total || 0);

    // Days since first receipt
    const firstReceipt = await Receipt.findOne({
        where: { userId },
        order: [['createdAt', 'ASC']],
        attributes: ['createdAt']
    });
    const daysSinceFirst = firstReceipt
        ? Math.floor((Date.now() - new Date(firstReceipt.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    // Current streak (consecutive days with receipts)
    const currentStreak = await calculateCurrentStreak(userId);

    return {
        totalReceipts,
        uniqueProducts,
        uniqueMerchants,
        totalSaved,
        totalSpent,
        daysSinceFirst,
        currentStreak
    };
}

/**
 * Calculate current streak of consecutive days with receipts
 */
async function calculateCurrentStreak(userId) {
    const receipts = await Receipt.findAll({
        where: { userId },
        attributes: ['purchaseDate', 'createdAt'],
        order: [['purchaseDate', 'DESC'], ['createdAt', 'DESC']],
        limit: 100 // Check last 100 receipts for performance
    });

    if (receipts.length === 0) return 0;

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const receiptDates = new Set();
    receipts.forEach(r => {
        const date = new Date(r.purchaseDate || r.createdAt);
        date.setHours(0, 0, 0, 0);
        receiptDates.add(date.getTime());
    });

    // Check consecutive days backwards from today
    while (receiptDates.has(currentDate.getTime())) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
    }

    // Allow 1 day grace period (yesterday counts as today)
    if (streak === 0) {
        currentDate = new Date();
        currentDate.setDate(currentDate.getDate() - 1);
        currentDate.setHours(0, 0, 0, 0);
        if (receiptDates.has(currentDate.getTime())) {
            streak = 1;
        }
    }

    return streak;
}

/**
 * Calculate the highest tier achieved for a badge type
 */
function calculateTieredBadge(badgeType, value, definition) {
    let highestTier = null;

    for (const tier of definition.tiers) {
        if (value >= tier.threshold) {
            highestTier = tier;
        } else {
            break; // Tiers are in ascending order
        }
    }

    if (!highestTier) return null;

    // Find next tier for progress tracking
    const currentIndex = definition.tiers.indexOf(highestTier);
    const nextTier = definition.tiers[currentIndex + 1];

    return {
        id: highestTier.key,
        type: badgeType,
        level: highestTier.level,
        icon: definition.icon,
        currentValue: value,
        threshold: highestTier.threshold,
        nextThreshold: nextTier?.threshold,
        progress: nextTier ? (value / nextTier.threshold) * 100 : 100,
        earned: true
    };
}

/**
 * Get badge display information with translations
 * This will be called by the controller with the user's locale
 */
export function getBadgeDisplayInfo(badge, t) {
    const translationKey = `badge_${badge.id}`;

    return {
        ...badge,
        title: t(translationKey) || badge.id,
        description: t(`${translationKey}_desc`) || ''
    };
}
