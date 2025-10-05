import authService from '../services/authService.js';
import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import { calculateUserBadges, getBadgeDisplayInfo } from '../services/badgeService.js';
import { addSignedUrlsToProfile, generateSignedUrl } from '../utils/urlSigner.js';

export const register = asyncHandler(async (req, res) => {
    const userData = {
        ...req.body,
        ipAddress: req.ip,
        deviceInfo: {
            userAgent: req.get('user-agent'),
            platform: req.get('sec-ch-ua-platform'),
            mobile: req.get('sec-ch-ua-mobile')
        }
    };

    const result = await authService.register(userData);

    // Add signed URLs to user profile (24 hours expiration)
    if (result.user) {
        result.user = addSignedUrlsToProfile(result.user, 86400);
    }

    res.status(201).json({
        status: 'success',
        message: req.t('auth.registration_success'),
        data: result
    });
});

export const login = asyncHandler(async (req, res) => {
    const ipAddress = req.ip;
    const deviceInfo = {
        userAgent: req.get('user-agent'),
        platform: req.get('sec-ch-ua-platform'),
        mobile: req.get('sec-ch-ua-mobile')
    };

    const result = await authService.login(req.body, ipAddress, deviceInfo);

    // Add signed URLs to user profile (24 hours expiration)
    if (result.user) {
        result.user = addSignedUrlsToProfile(result.user, 86400);
    }

    res.json({
        status: 'success',
        message: req.t('auth.login_success'),
        data: result
    });
});

export const refreshToken = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    const ipAddress = req.ip;
    const deviceInfo = {
        userAgent: req.get('user-agent'),
        platform: req.get('sec-ch-ua-platform'),
        mobile: req.get('sec-ch-ua-mobile')
    };

    log.info('Refresh token request received', {
        ip: ipAddress,
        tokenPrefix: refreshToken?.substring(0, 8),
        userAgent: deviceInfo.userAgent
    });

    const result = await authService.refreshAccessToken(refreshToken, ipAddress, deviceInfo);

    // Add signed URLs to user profile (24 hours expiration)
    if (result.user) {
        result.user = addSignedUrlsToProfile(result.user, 86400);
    }

    res.json({
        status: 'success',
        message: req.t('auth.token_refreshed_success'),
        data: result
    });
});

export const logout = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    await authService.logout(refreshToken);

    res.json({
        status: 'success',
        message: req.t('auth.logout_success')
    });
});

export const logoutAllDevices = asyncHandler(async (req, res) => {
    await authService.logoutAllDevices(req.userId);

    res.json({
        status: 'success',
        message: req.t('auth.logout_all_devices_success')
    });
});

export const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    await authService.changePassword(req.userId, currentPassword, newPassword);

    res.json({
        status: 'success',
        message: req.t('auth.password_changed_success')
    });
});

export const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    const result = await authService.forgotPassword(email);

    res.json({
        status: 'success',
        ...result
    });
});

export const resetPassword = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    await authService.resetPassword(token, password);

    res.json({
        status: 'success',
        message: req.t('auth.password_reset_success')
    });
});

export const verifyEmail = asyncHandler(async (req, res) => {
    const { token } = req.params;

    await authService.verifyEmail(token);

    res.json({
        status: 'success',
        message: req.t('auth.email_verified_success')
    });
});

export const getMe = asyncHandler(async (req, res) => {
    // Add signed URLs to user profile (24 hours expiration)
    const userWithSignedUrls = addSignedUrlsToProfile(req.user.toJSON(), 86400);

    res.json({
        status: 'success',
        data: {
            user: userWithSignedUrls
        }
    });
});

export const updateLanguagePreference = asyncHandler(async (req, res) => {
    const { language } = req.body;
    const userId = req.userId;

    if (!language || !['en', 'es', 'nl'].includes(language)) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.invalid_language')
        });
    }

    await req.user.update({ preferredLanguage: language });

    res.json({
        status: 'success',
        message: req.t('auth.language_updated_success'),
        data: {
            preferredLanguage: language
        }
    });
});

export const getUserBadges = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const badges = await calculateUserBadges(userId);

    // Add localized display information
    const localizedBadges = badges.map(badge => getBadgeDisplayInfo(badge, req.t));

    res.json({
        status: 'success',
        data: {
            badges: localizedBadges,
            total: badges.length
        }
    });
});

export const updateProfilePhoto = asyncHandler(async (req, res) => {
    const { imageUrl } = req.body;
    const userId = req.user.id;

    if (!imageUrl) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.required_field', { field: 'imageUrl' })
        });
    }

    await req.user.update({ profileImageUrl: imageUrl });

    log.info('Profile photo updated', {
        userId,
        imageUrl
    });

    // Generate signed URL for the profile image (24 hours expiration)
    const signedImageUrl = generateSignedUrl(imageUrl, 86400);

    res.json({
        status: 'success',
        message: req.t('auth.profile_photo_updated_success'),
        data: {
            profileImageUrl: signedImageUrl
        }
    });
});

export const deleteProfilePhoto = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    await req.user.update({ profileImageUrl: null });

    log.info('Profile photo deleted', { userId });

    res.json({
        status: 'success',
        message: req.t('auth.profile_photo_deleted_success')
    });
});