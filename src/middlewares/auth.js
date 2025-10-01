import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import config from '../config/environment.js';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { asyncHandler } from '../utils/errors.js';

export const authenticate = asyncHandler(async (req, res, next) => {
    let token;

    // Extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        throw new AuthenticationError('No token provided');
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, config.security.jwt.secret);

        // Get user from database
        const user = await User.findByPk(decoded.id, {
            attributes: { exclude: ['password'] }
        });

        if (!user) {
            throw new AuthenticationError('User not found');
        }

        if (!user.isActive) {
            throw new AuthenticationError('Account is deactivated');
        }

        // Attach user to request
        req.user = user;
        req.userId = user.id;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            throw new AuthenticationError('Invalid token');
        }
        if (error.name === 'TokenExpiredError') {
            throw new AuthenticationError('Token expired');
        }
        throw error;
    }
});

export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new AuthenticationError('Authentication required');
        }

        if (!roles.includes(req.user.role)) {
            throw new AuthorizationError(`This action requires one of these roles: ${roles.join(', ')}`);
        }

        next();
    };
};

export const optionalAuth = asyncHandler(async (req, res, next) => {
    let token;

    // Extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        // No token, continue without authentication
        return next();
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, config.security.jwt.secret);

        // Get user from database
        const user = await User.findByPk(decoded.id, {
            attributes: { exclude: ['password'] }
        });

        if (user && user.isActive) {
            // Attach user to request if valid
            req.user = user;
            req.userId = user.id;
        }
    } catch (error) {
        // Invalid token, continue without authentication
        // Log the error but don't throw
        console.error('Optional auth token validation failed:', error.message);
    }

    next();
});

export const requireEmailVerification = (req, res, next) => {
    if (!req.user) {
        throw new AuthenticationError('Authentication required');
    }

    if (!req.user.emailVerified) {
        throw new AuthorizationError('Email verification required');
    }

    next();
};