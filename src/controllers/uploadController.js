import multer from "multer";
import { asyncHandler } from '../utils/errors.js';
import { saveUserFile, FILE_CATEGORIES } from '../utils/fileStorage.js';
import { generateSignedUrl } from '../utils/urlSigner.js';

// Configuración de multer → usa memoria temporal
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || 5242880) // 5MB default
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/jpg').split(',');
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
        }
    }
});

export const uploadReceipt = [
    upload.single("file"),
    asyncHandler(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No file uploaded"
            });
        }

        // Get user ID from authenticated request
        const userId = req.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        // Save file to user's receipts directory
        const { relativePath } = await saveUserFile(
            userId,
            FILE_CATEGORIES.RECEIPTS,
            req.file.buffer,
            req.file.originalname
        );

        // Generate signed URL (2 hours expiration)
        const signedUrl = generateSignedUrl(relativePath, 7200);

        res.json({
            success: true,
            image_url: signedUrl,
            relative_path: relativePath // For storage in database
        });
    })
];

export const uploadProfilePhoto = [
    upload.single("file"),
    asyncHandler(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No file uploaded"
            });
        }

        // Get user ID from authenticated request
        const userId = req.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        // Save file to user's profile directory
        const { relativePath } = await saveUserFile(
            userId,
            FILE_CATEGORIES.PROFILE,
            req.file.buffer,
            req.file.originalname
        );

        // Generate signed URL (24 hours expiration for profile images)
        const signedUrl = generateSignedUrl(relativePath, 86400);

        res.json({
            success: true,
            image_url: signedUrl,
            relative_path: relativePath // For storage in database
        });
    })
];
