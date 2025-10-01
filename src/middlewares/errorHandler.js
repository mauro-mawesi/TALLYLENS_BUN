import { AppError, formatErrorResponse } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import config from '../config/environment.js';

const sendErrorDev = (err, req, res) => {
    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack,
        errors: err.errors
    });
};

const sendErrorProd = (err, req, res) => {
    const statusCode = err.statusCode || 500;

    // Operational, trusted error: send message to client
    if (err.isOperational) {
        res.status(statusCode).json({
            status: err.status,
            message: err.message,
            errors: err.errors
        });
    } else {
        // Programming or other unknown error: don't leak error details
        log.error('💥 ERROR:', err);

        res.status(500).json({
            status: 'error',
            message: 'Something went very wrong!'
        });
    }
};

export default function errorHandler(err, req, res, next) {
    // Default to 500 server error
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log error
    const errorContext = {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        statusCode: err.statusCode,
        userId: req.user?.id,
    };

    if (err.statusCode >= 500) {
        log.error(`Error ${err.statusCode}:`, {
            ...errorContext,
            error: err.message,
            stack: err.stack
        });
    } else {
        log.warn(`Client error ${err.statusCode}:`, {
            ...errorContext,
            error: err.message
        });
    }

    // Handle specific error types
    if (err.name === 'CastError') {
        err = new AppError('Invalid ID format', 400);
    }

    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => e.message);
        err = new AppError('Invalid input data', 400);
        err.errors = errors;
    }

    if (err.code === 11000) {
        const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
        err = new AppError(`Duplicate field value: ${value}. Please use another value!`, 400);
    }

    // Send error response
    if (config.isDevelopment) {
        sendErrorDev(err, req, res);
    } else {
        sendErrorProd(err, req, res);
    }
}
