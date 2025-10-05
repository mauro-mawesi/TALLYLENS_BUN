import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

// Import configuration and services
import config from "./config/environment.js";
import { log } from "./utils/logger.js";
import { setupSwagger } from "./config/swagger.js";
import setupAssociations from "./models/associations.js";
import { languageDetector } from "./config/i18n.js";

// Import middlewares
import {
    securityHeaders,
    compressionMiddleware,
    corsConfig,
    requestId,
    hideSensitiveData,
    securityLogger,
    preventParameterPollution,
    validateContentType
} from "./middlewares/security.js";
import { generalLimiter } from "./middlewares/rateLimiter.js";
import { sanitizeInput } from "./middlewares/validation.js";
import errorHandler from "./middlewares/errorHandler.js";

// Import routes
import authRouter from "./routes/auth.js";
import receiptsRouter from "./routes/receipts.js";
import ocrRouter from "./routes/ocr.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import imageRoutes from "./routes/imageRoutes.js";
import healthRouter from "./routes/health.js";
import productsRouter from "./routes/products.js";
import analyticsRouter from "./routes/analytics.js";
import budgetsRouter from "./routes/budgets.js";
import notificationsRouter from "./routes/notifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy (important for production behind load balancer)
app.set('trust proxy', 1);

// Setup model associations
setupAssociations();

// Basic security middleware
app.use(requestId);
app.use(hideSensitiveData);
app.use(securityHeaders);

// Request logging
app.use(securityLogger);

// CORS configuration
import cors from "cors";
app.use(cors(corsConfig));

// Compression
app.use(compressionMiddleware);

// Body parsing with security
app.use(express.json({
    limit: config.upload.maxFileSize || "5mb",
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Content type validation
app.use(validateContentType(['application/json', 'multipart/form-data']));

// Parameter pollution prevention
app.use(preventParameterPollution);

// Input sanitization
app.use(sanitizeInput);

// Language detection and i18n
app.use(languageDetector);

// Rate limiting
app.use('/api/', generalLimiter);

// Secure image serving with signed URLs (replaces public /uploads)
// Images are now served via /secure/* with time-limited signed URLs
import { validateSignedUrl, serveSecureImage } from './middlewares/imageAuth.js';
app.use('/secure', validateSignedUrl, serveSecureImage);

// API Documentation
if (config.isDevelopment) {
    setupSwagger(app);
}

// Health checks (no auth required)
app.use("/api/health", healthRouter);

// API routes
app.use("/api/auth", authRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/products", productsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/ocr", ocrRouter);
app.use("/api/upload", uploadRoutes);
app.use("/api/images", imageRoutes);

// Development-only routes
// (none currently)

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Receipts Management API',
        version: '1.0.0',
        environment: config.env,
        documentation: config.isDevelopment ? '/api-docs' : undefined,
        health: '/api/health'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Endpoint not found',
        path: req.originalUrl
    });
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
    log.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

export default app;
