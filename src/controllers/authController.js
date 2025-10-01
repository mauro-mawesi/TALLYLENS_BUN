import authService from '../services/authService.js';
import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';

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

    const result = await authService.refreshAccessToken(refreshToken, ipAddress, deviceInfo);

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
    res.json({
        status: 'success',
        data: {
            user: req.user.toJSON()
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