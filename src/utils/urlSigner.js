import crypto from 'crypto';
import path from 'path';
import url from 'url';

const SECRET_KEY = process.env.IMAGE_SECRET || 'change-me-in-production-use-strong-secret';
const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/**
 * Generates a signed URL for secure image access
 * @param {string} imagePath - Relative path to image (e.g., 'receipts/image.jpg' or full URL)
 * @param {number} expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns {string} Signed URL
 */
export function generateSignedUrl(imagePath, expiresIn = 3600) {
    if (!imagePath) {
        return null;
    }

    // Extract path from full URL if provided
    let relativePath = imagePath;

    try {
        // If it's a full URL, extract the path
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            const parsed = url.parse(imagePath);
            // Remove /uploads/ prefix if present
            relativePath = parsed.pathname.replace(/^\/uploads\//, '');
        } else if (imagePath.startsWith('/uploads/')) {
            // Remove /uploads/ prefix
            relativePath = imagePath.replace(/^\/uploads\//, '');
        } else if (imagePath.startsWith('/')) {
            // Remove leading slash
            relativePath = imagePath.substring(1);
        }
    } catch (error) {
        // If parsing fails, use as is
        relativePath = imagePath;
    }

    // Calculate expiration timestamp
    const expires = Math.floor(Date.now() / 1000) + expiresIn;

    // Generate signature
    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(`${relativePath}:${expires}`)
        .digest('hex');

    // Build signed URL
    const signedUrl = `${BASE_URL}/secure/${relativePath}?expires=${expires}&signature=${signature}`;

    return signedUrl;
}

/**
 * Generates signed URLs for multiple images
 * @param {Array<string>} imagePaths - Array of image paths
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {Array<string>} Array of signed URLs
 */
export function generateSignedUrls(imagePaths, expiresIn = 3600) {
    if (!Array.isArray(imagePaths)) {
        return [];
    }

    return imagePaths
        .filter(path => path) // Remove null/undefined
        .map(path => generateSignedUrl(path, expiresIn));
}

/**
 * Extracts the original path from a signed URL
 * @param {string} signedUrl - Signed URL
 * @returns {string} Original path
 */
export function extractPathFromSignedUrl(signedUrl) {
    try {
        const parsed = url.parse(signedUrl);
        // Extract path between /secure/ and query params
        const match = parsed.pathname.match(/\/secure\/(.+)/);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

/**
 * Checks if a URL is already signed
 * @param {string} imageUrl - Image URL to check
 * @returns {boolean} True if URL contains signature parameters
 */
export function isSignedUrl(imageUrl) {
    if (!imageUrl) {
        return false;
    }

    try {
        const parsed = url.parse(imageUrl, true);
        return !!(parsed.query.expires && parsed.query.signature);
    } catch (error) {
        return false;
    }
}

/**
 * Adds signed URLs to a receipt object
 * @param {Object} receipt - Receipt object
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {Object} Receipt with signed URLs
 */
export function addSignedUrlsToReceipt(receipt, expiresIn = 3600) {
    if (!receipt) {
        return receipt;
    }

    const receiptCopy = { ...receipt };

    // Sign main image URL
    if (receiptCopy.image_url) {
        receiptCopy.image_url = generateSignedUrl(receiptCopy.image_url, expiresIn);
    }

    // Sign thumbnail URL if exists
    if (receiptCopy.image_thumbnail_url) {
        receiptCopy.image_thumbnail_url = generateSignedUrl(receiptCopy.image_thumbnail_url, expiresIn);
    }

    return receiptCopy;
}

/**
 * Adds signed URLs to user profile
 * @param {Object} user - User object
 * @param {number} expiresIn - Expiration time in seconds (default: 24 hours for profiles)
 * @returns {Object} User with signed URLs
 */
export function addSignedUrlsToProfile(user, expiresIn = 86400) {
    if (!user) {
        return user;
    }

    const userCopy = { ...user };

    // Sign profile image URL
    if (userCopy.profile_image_url) {
        userCopy.profile_image_url = generateSignedUrl(userCopy.profile_image_url, expiresIn);
    }

    return userCopy;
}
