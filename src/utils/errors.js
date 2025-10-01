// Custom error classes for better error handling

export class AppError extends Error {
    constructor(message, statusCode, isOperational = true, stack = '') {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = isOperational;

        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class ValidationError extends AppError {
    constructor(message, errors = []) {
        super(message, 400);
        this.errors = errors;
        this.name = 'ValidationError';
    }
}

export class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

export class AuthorizationError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403);
        this.name = 'AuthorizationError';
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404);
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends AppError {
    constructor(message = 'Resource already exists') {
        super(message, 409);
        this.name = 'ConflictError';
    }
}

export class RateLimitError extends AppError {
    constructor(message = 'Too many requests') {
        super(message, 429);
        this.name = 'RateLimitError';
    }
}

export class ExternalServiceError extends AppError {
    constructor(service, message) {
        super(`External service error (${service}): ${message}`, 503);
        this.name = 'ExternalServiceError';
        this.service = service;
    }
}

export class DatabaseError extends AppError {
    constructor(message = 'Database operation failed') {
        super(message, 500);
        this.name = 'DatabaseError';
        this.isOperational = false;
    }
}

export class FileUploadError extends AppError {
    constructor(message = 'File upload failed') {
        super(message, 400);
        this.name = 'FileUploadError';
    }
}

// Error factory for creating errors from various sources
export const createError = (error, defaultMessage = 'An error occurred') => {
    // If it's already our custom error, return it
    if (error instanceof AppError) {
        return error;
    }

    // Handle Sequelize errors
    if (error.name === 'SequelizeValidationError') {
        const messages = error.errors.map(e => e.message);
        return new ValidationError('Validation failed', messages);
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
        return new ConflictError('Record already exists');
    }

    if (error.name === 'SequelizeDatabaseError') {
        return new DatabaseError(error.message);
    }

    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
        return new AuthenticationError('Invalid token');
    }

    if (error.name === 'TokenExpiredError') {
        return new AuthenticationError('Token expired');
    }

    // Handle Multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
        return new FileUploadError('File too large');
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return new FileUploadError('Unexpected file field');
    }

    // Default error
    return new AppError(error.message || defaultMessage, 500, false);
};

// Async error handler wrapper
export const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Error response formatter
export const formatErrorResponse = (error) => {
    const response = {
        status: error.status || 'error',
        message: error.message,
    };

    if (error.errors && error.errors.length > 0) {
        response.errors = error.errors;
    }

    if (process.env.NODE_ENV === 'development') {
        response.stack = error.stack;
        response.error = error;
    }

    return response;
};