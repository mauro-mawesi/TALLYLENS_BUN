import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { log } from '../utils/logger.js';

const SECRET_KEY = process.env.IMAGE_SECRET || 'change-me-in-production-use-strong-secret';

/**
 * Validates signed URL parameters for secure image access
 * URL format: /secure/:path?expires=timestamp&signature=hash
 */
export function validateSignedUrl(req, res, next) {
    const { expires, signature } = req.query;
    // Extract path after /secure/ (req.path removes the mount point)
    const imagePath = req.path.startsWith('/') ? req.path.substring(1) : req.path;

    // Validate required parameters
    if (!expires || !signature) {
        log.warn('Image access denied: missing signature parameters', {
            path: imagePath,
            ip: req.ip
        });
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing signature parameters'
        });
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresTimestamp = parseInt(expires);

    if (isNaN(expiresTimestamp) || expiresTimestamp < now) {
        log.warn('Image access denied: expired URL', {
            path: imagePath,
            expired: new Date(expiresTimestamp * 1000).toISOString(),
            ip: req.ip
        });
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'URL expired'
        });
    }

    // Verify signature
    const expectedSignature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(`${imagePath}:${expires}`)
        .digest('hex');

    if (signature !== expectedSignature) {
        log.warn('Image access denied: invalid signature', {
            path: imagePath,
            ip: req.ip
        });
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid signature'
        });
    }

    // Store imagePath in req for next middleware
    req.imagePath = imagePath;

    // Signature is valid, proceed
    next();
}

/**
 * Serves the requested image file after signature validation
 */
export async function serveSecureImage(req, res) {
    // Get imagePath from previous middleware
    const imagePath = req.imagePath;

    if (!imagePath) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid image path'
        });
    }

    // Build full path (supports both new structure userId/category/filename and legacy filename)
    const fullPath = path.join(process.cwd(), 'uploads', imagePath);

    try {
        // Check if file exists
        await fs.access(fullPath);

        // Set appropriate cache headers (short cache since URLs are temporary)
        res.set({
            'Cache-Control': 'private, max-age=3600', // 1 hour cache
            'X-Content-Type-Options': 'nosniff'
        });

        log.debug('Serving secure image', { path: imagePath });
        res.sendFile(fullPath);

    } catch (error) {
        if (error.code === 'ENOENT') {
            log.warn('Image not found', { path: imagePath });
            return res.status(404).json({
                error: 'Not Found',
                message: 'Image not found'
            });
        }

        log.error('Error serving image', {
            path: imagePath,
            error: error.message
        });
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Error serving image'
        });
    }
}
