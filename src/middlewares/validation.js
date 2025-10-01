import { validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors.js';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss';

// Validate request using express-validator
export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const extractedErrors = errors.array().map(err => ({
            field: err.path,
            message: err.msg,
            value: err.value
        }));

        throw new ValidationError('Validation failed', extractedErrors);
    }
    next();
};

// Sanitize data to prevent NoSQL injection and XSS
export const sanitizeInput = (req, res, next) => {
    // Remove any keys that start with '$' or contain '.'
    mongoSanitize.sanitize(req.body);
    mongoSanitize.sanitize(req.query);
    mongoSanitize.sanitize(req.params);

    // Clean XSS from user input
    const sanitizeObject = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = xss(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitizeObject(obj[key]);
            }
        }
    };

    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);

    next();
};

// Custom validators
export const validators = {
    // UUID validator
    isUUID: (field) => ({
        in: ['params', 'body', 'query'],
        isUUID: {
            errorMessage: `${field} must be a valid UUID`
        }
    }),

    // URL validator
    isURL: (field) => ({
        in: ['body'],
        isURL: {
            errorMessage: `${field} must be a valid URL`,
            options: {
                protocols: ['http', 'https'],
                require_protocol: true
            }
        }
    }),

    // Image URL validator
    isImageURL: (field) => ({
        in: ['body'],
        custom: {
            options: (value) => {
                if (!value) return true;
                const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
                const hasImageExtension = imageExtensions.some(ext =>
                    value.toLowerCase().endsWith(ext)
                );
                if (!hasImageExtension) {
                    throw new Error(`${field} must be an image URL`);
                }
                return true;
            }
        }
    }),

    // File validator
    isFile: (field, options = {}) => ({
        custom: {
            options: (value, { req }) => {
                const file = req.file || req.files?.[field];
                if (!file && options.required) {
                    throw new Error(`${field} is required`);
                }

                if (file) {
                    // Check file size
                    if (options.maxSize && file.size > options.maxSize) {
                        throw new Error(`${field} size must not exceed ${options.maxSize} bytes`);
                    }

                    // Check mime type
                    if (options.mimeTypes && !options.mimeTypes.includes(file.mimetype)) {
                        throw new Error(`${field} must be one of: ${options.mimeTypes.join(', ')}`);
                    }
                }

                return true;
            }
        }
    }),

    // Pagination validators
    pagination: () => [
        {
            in: ['query'],
            optional: true,
            isInt: {
                options: { min: 1 },
                errorMessage: 'Page must be a positive integer'
            },
            toInt: true
        },
        {
            in: ['query'],
            optional: true,
            isInt: {
                options: { min: 1, max: 100 },
                errorMessage: 'Limit must be between 1 and 100'
            },
            toInt: true
        }
    ],

    // Date range validators
    dateRange: () => [
        {
            in: ['query'],
            optional: true,
            isISO8601: {
                errorMessage: 'Start date must be a valid ISO 8601 date'
            }
        },
        {
            in: ['query'],
            optional: true,
            isISO8601: {
                errorMessage: 'End date must be a valid ISO 8601 date'
            },
            custom: {
                options: (value, { req }) => {
                    if (value && req.query.startDate && new Date(value) < new Date(req.query.startDate)) {
                        throw new Error('End date must be after start date');
                    }
                    return true;
                }
            }
        }
    ],

    // Sanitizers
    sanitizeString: (field) => ({
        in: ['body'],
        trim: true,
        escape: true,
        stripLow: true
    }),

    // Category validator
    isValidCategory: (field) => ({
        in: ['body', 'query'],
        optional: true,
        isIn: {
            options: [['Mercado', 'Transporte', 'Comida', 'Combustible', 'Otros']],
            errorMessage: 'Category must be one of: Mercado, Transporte, Comida, Combustible, Otros'
        }
    })
};

// Validation schemas for different routes
export const validationSchemas = {
    createReceipt: [
        validators.isURL('image_url'),
        validators.sanitizeString('raw_text'),
        validators.isValidCategory('category')
    ],

    updateReceipt: [
        validators.isUUID('id'),
        validators.isURL('image_url'),
        validators.sanitizeString('raw_text'),
        validators.isValidCategory('category')
    ],

    getReceipts: [
        ...validators.pagination(),
        ...validators.dateRange(),
        validators.isValidCategory('category')
    ],

    uploadFile: [
        validators.isFile('file', {
            required: true,
            maxSize: 5 * 1024 * 1024, // 5MB
            mimeTypes: ['image/jpeg', 'image/png', 'image/jpg']
        })
    ]
};