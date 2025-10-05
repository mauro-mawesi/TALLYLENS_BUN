import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import config from '../config/environment.js';
import { AuthenticationError, ValidationError, ConflictError } from '../utils/errors.js';
import { log } from '../utils/logger.js';

class AuthService {
    constructor() {
        // Lock para prevenir refresh concurrentes del mismo token
        this.refreshLocks = new Map(); // tokenString -> Promise
    }

    generateAccessToken(user) {
        const payload = {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role
        };

        return jwt.sign(payload, config.security.jwt.secret, {
            expiresIn: config.security.jwt.expiration
        });
    }

    generateRefreshToken() {
        return crypto.randomBytes(64).toString('hex');
    }

    async createRefreshToken(user, ipAddress, deviceInfo) {
        const token = this.generateRefreshToken();
        const expiresAt = new Date();

        // Parse refresh token expiration (e.g., '7d' -> 7 days)
        const duration = config.security.jwt.refreshExpiration;
        const value = parseInt(duration);
        const unit = duration.slice(-1);

        switch (unit) {
            case 'd':
                expiresAt.setDate(expiresAt.getDate() + value);
                break;
            case 'h':
                expiresAt.setHours(expiresAt.getHours() + value);
                break;
            case 'm':
                expiresAt.setMinutes(expiresAt.getMinutes() + value);
                break;
            default:
                expiresAt.setDate(expiresAt.getDate() + 7); // Default 7 days
        }

        const refreshToken = await RefreshToken.create({
            token,
            userId: user.id,
            ipAddress,
            deviceInfo,
            expiresAt
        });

        return refreshToken.token;
    }

    async register(userData) {
        const { email, username, password, firstName, lastName } = userData;

        // Check if user exists
        const existingEmail = await User.findByEmail(email);
        if (existingEmail) {
            throw new ConflictError('Email already registered');
        }

        const existingUsername = await User.findByUsername(username);
        if (existingUsername) {
            throw new ConflictError('Username already taken');
        }

        // Create user
        const user = await User.create({
            email,
            username,
            password,
            firstName,
            lastName,
            emailVerificationToken: crypto.randomBytes(32).toString('hex')
        });

        log.info('New user registered', { userId: user.id, email: user.email });

        // Generate tokens
        const accessToken = this.generateAccessToken(user);
        const refreshToken = await this.createRefreshToken(user, userData.ipAddress, userData.deviceInfo);

        return {
            user: user.toJSON(),
            tokens: {
                accessToken,
                refreshToken
            }
        };
    }

    async login(credentials, ipAddress, deviceInfo) {
        const { email, username, password } = credentials;

        // Find user by email or username
        let user;
        if (email) {
            user = await User.findByEmail(email);
        } else if (username) {
            user = await User.findByUsername(username);
        } else {
            throw new ValidationError('Email or username is required');
        }

        if (!user) {
            throw new AuthenticationError('Invalid credentials');
        }

        // Check if account is locked
        if (user.isLocked()) {
            throw new AuthenticationError('Account is locked due to multiple failed login attempts');
        }

        // Check if account is active
        if (!user.isActive) {
            throw new AuthenticationError('Account is deactivated');
        }

        // Verify password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            await user.incrementLoginAttempts();
            throw new AuthenticationError('Invalid credentials');
        }

        // Reset login attempts on successful login
        await user.resetLoginAttempts();

        log.info('User logged in', { userId: user.id, email: user.email });

        // Generate tokens
        const accessToken = this.generateAccessToken(user);
        const refreshToken = await this.createRefreshToken(user, ipAddress, deviceInfo);

        return {
            user: user.toJSON(),
            tokens: {
                accessToken,
                refreshToken
            }
        };
    }

    async refreshAccessToken(refreshTokenString, ipAddress, deviceInfo) {
        // Implementar lock por token para evitar race conditions
        // Si múltiples requests intentan refresh del mismo token simultáneamente,
        // solo uno procede, los demás esperan y usan el resultado del primero
        if (this.refreshLocks.has(refreshTokenString)) {
            log.info('Refresh already in progress, waiting for result', {
                token: refreshTokenString?.substring(0, 8)
            });
            return await this.refreshLocks.get(refreshTokenString);
        }

        // Crear promise que ejecuta el refresh
        const refreshPromise = this._doRefresh(refreshTokenString, ipAddress, deviceInfo);

        // Guardar en lock map
        this.refreshLocks.set(refreshTokenString, refreshPromise);

        try {
            const result = await refreshPromise;
            return result;
        } finally {
            // Remover lock después de completar (éxito o fallo)
            // Usar timeout para evitar que locks queden colgados
            setTimeout(() => {
                this.refreshLocks.delete(refreshTokenString);
            }, 1000);
        }
    }

    async _doRefresh(refreshTokenString, ipAddress, deviceInfo) {
        const refreshToken = await RefreshToken.findOne({
            where: { token: refreshTokenString },
            include: [{
                model: User,
                as: 'user'
            }]
        });

        if (!refreshToken) {
            log.warn('Refresh token not found in database', { token: refreshTokenString?.substring(0, 8) });
            throw new AuthenticationError('Invalid refresh token');
        }

        if (!refreshToken.isValid()) {
            log.warn('Refresh token is invalid', {
                tokenId: refreshToken.id,
                revoked: refreshToken.revoked,
                expiresAt: refreshToken.expiresAt,
                now: new Date()
            });
            throw new AuthenticationError('Refresh token expired or revoked');
        }

        const user = refreshToken.user;
        if (!user || !user.isActive) {
            throw new AuthenticationError('User not found or inactive');
        }

        // Generate new tokens BEFORE revoking old one
        // This prevents race conditions where multiple requests try to refresh simultaneously
        const accessToken = this.generateAccessToken(user);
        const newRefreshToken = await this.createRefreshToken(user, ipAddress, deviceInfo);

        // Now revoke old token (after new one is created)
        await refreshToken.revoke();

        log.info('Access token refreshed', {
            userId: user.id,
            oldTokenRevoked: true,
            newTokenCreated: true
        });

        return {
            tokens: {
                accessToken,
                refreshToken: newRefreshToken
            }
        };
    }

    async logout(refreshTokenString) {
        const refreshToken = await RefreshToken.findOne({
            where: { token: refreshTokenString }
        });

        if (refreshToken && !refreshToken.revoked) {
            await refreshToken.revoke();
            log.info('User logged out', { userId: refreshToken.userId });
        }

        return { message: 'Logged out successfully' };
    }

    async logoutAllDevices(userId) {
        await RefreshToken.revokeAllUserTokens(userId);
        log.info('User logged out from all devices', { userId });
        return { message: 'Logged out from all devices successfully' };
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = await User.findByPk(userId);
        if (!user) {
            throw new AuthenticationError('User not found');
        }

        const isPasswordValid = await user.comparePassword(currentPassword);
        if (!isPasswordValid) {
            throw new AuthenticationError('Current password is incorrect');
        }

        user.password = newPassword;
        await user.save();

        // Revoke all refresh tokens
        await RefreshToken.revokeAllUserTokens(userId);

        log.info('User password changed', { userId });

        return { message: 'Password changed successfully' };
    }

    async forgotPassword(email) {
        const user = await User.findByEmail(email);
        if (!user) {
            // Don't reveal if user exists
            return { message: 'If an account exists for this email, a reset link will be sent' };
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 3600000); // 1 hour

        user.passwordResetToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');
        user.passwordResetExpires = resetExpires;
        await user.save();

        log.info('Password reset requested', { userId: user.id });

        // TODO: Send email with reset token
        // For now, return the token (remove in production)
        return {
            message: 'Password reset token generated',
            resetToken: resetToken // Remove this in production
        };
    }

    async resetPassword(resetToken, newPassword) {
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        const user = await User.findOne({
            where: {
                passwordResetToken: hashedToken,
                passwordResetExpires: {
                    [Op.gt]: new Date()
                }
            }
        });

        if (!user) {
            throw new AuthenticationError('Invalid or expired reset token');
        }

        user.password = newPassword;
        user.passwordResetToken = null;
        user.passwordResetExpires = null;
        await user.save();

        // Revoke all refresh tokens
        await RefreshToken.revokeAllUserTokens(user.id);

        log.info('Password reset completed', { userId: user.id });

        return { message: 'Password reset successfully' };
    }

    async verifyEmail(verificationToken) {
        const user = await User.findOne({
            where: {
                emailVerificationToken: verificationToken
            }
        });

        if (!user) {
            throw new AuthenticationError('Invalid verification token');
        }

        user.emailVerified = true;
        user.emailVerificationToken = null;
        await user.save();

        log.info('Email verified', { userId: user.id });

        return { message: 'Email verified successfully' };
    }
}

export default new AuthService();