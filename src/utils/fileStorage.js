import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base uploads directory
const UPLOADS_BASE = path.join(__dirname, '../../uploads');

/**
 * File categories for organizing user files
 */
export const FILE_CATEGORIES = {
    RECEIPTS: 'receipts',
    PROFILE: 'profile',
    TEMP: 'temp'
};

/**
 * Ensures a directory exists, creates it if it doesn't
 * @param {string} dirPath - Directory path to ensure
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.promises.access(dirPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.promises.mkdir(dirPath, { recursive: true });
            log.debug('Directory created', { path: dirPath });
        } else {
            throw error;
        }
    }
}

/**
 * Gets the user's directory path
 * @param {string} userId - User ID
 * @returns {string} User directory path
 */
export function getUserDirectory(userId) {
    return path.join(UPLOADS_BASE, userId);
}

/**
 * Gets the user's category directory path
 * @param {string} userId - User ID
 * @param {string} category - File category (receipts, profile, temp)
 * @returns {string} Category directory path
 */
export function getUserCategoryDirectory(userId, category) {
    return path.join(UPLOADS_BASE, userId, category);
}

/**
 * Ensures user's directory structure exists
 * @param {string} userId - User ID
 * @param {string} category - File category (receipts, profile, temp)
 * @returns {Promise<string>} Category directory path
 */
export async function ensureUserDirectory(userId, category) {
    const categoryPath = getUserCategoryDirectory(userId, category);
    await ensureDirectoryExists(categoryPath);
    return categoryPath;
}

/**
 * Generates a unique filename
 * @param {string} originalName - Original filename
 * @returns {string} Unique filename
 */
export function generateUniqueFilename(originalName) {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(originalName);
    return `${timestamp}-${random}${ext}`;
}

/**
 * Saves a file to user's category directory
 * @param {string} userId - User ID
 * @param {string} category - File category
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} originalName - Original filename
 * @returns {Promise<{fullPath: string, relativePath: string, filename: string}>}
 */
export async function saveUserFile(userId, category, fileBuffer, originalName) {
    const categoryDir = await ensureUserDirectory(userId, category);
    const filename = generateUniqueFilename(originalName);
    const fullPath = path.join(categoryDir, filename);
    const relativePath = `${userId}/${category}/${filename}`;

    await fs.promises.writeFile(fullPath, fileBuffer);

    log.info('File saved', {
        userId,
        category,
        filename,
        size: fileBuffer.length
    });

    return {
        fullPath,
        relativePath,
        filename
    };
}

/**
 * Deletes a user file
 * @param {string} relativePath - Relative path from uploads directory (e.g., "userId/receipts/file.jpg")
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteUserFile(relativePath) {
    try {
        const fullPath = path.join(UPLOADS_BASE, relativePath);
        await fs.promises.unlink(fullPath);
        log.info('File deleted', { path: relativePath });
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            log.warn('File not found for deletion', { path: relativePath });
            return false;
        }
        throw error;
    }
}

/**
 * Gets full path from relative path
 * @param {string} relativePath - Relative path from uploads directory
 * @returns {string} Full path
 */
export function getFullPath(relativePath) {
    return path.join(UPLOADS_BASE, relativePath);
}

/**
 * Extracts userId, category, and filename from relative path
 * @param {string} relativePath - Relative path (e.g., "userId/receipts/file.jpg")
 * @returns {{userId: string, category: string, filename: string}|null}
 */
export function parseRelativePath(relativePath) {
    try {
        const parts = relativePath.split('/');
        if (parts.length !== 3) {
            return null;
        }
        return {
            userId: parts[0],
            category: parts[1],
            filename: parts[2]
        };
    } catch (error) {
        return null;
    }
}

/**
 * Deletes all files for a user (useful for account deletion)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of files deleted
 */
export async function deleteAllUserFiles(userId) {
    try {
        const userDir = getUserDirectory(userId);
        let deletedCount = 0;

        const categories = await fs.promises.readdir(userDir);

        for (const category of categories) {
            const categoryPath = path.join(userDir, category);
            const stats = await fs.promises.stat(categoryPath);

            if (stats.isDirectory()) {
                const files = await fs.promises.readdir(categoryPath);
                for (const file of files) {
                    await fs.promises.unlink(path.join(categoryPath, file));
                    deletedCount++;
                }
                await fs.promises.rmdir(categoryPath);
            }
        }

        await fs.promises.rmdir(userDir);

        log.info('All user files deleted', { userId, count: deletedCount });
        return deletedCount;
    } catch (error) {
        if (error.code === 'ENOENT') {
            log.warn('User directory not found', { userId });
            return 0;
        }
        throw error;
    }
}
