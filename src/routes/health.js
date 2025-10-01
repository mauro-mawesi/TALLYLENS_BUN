import { Router } from 'express';
import {
    healthCheck,
    detailedHealthCheck,
    liveness,
    readiness,
    metrics,
    performance
} from '../controllers/healthController.js';
import { generalLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

// Apply rate limiting to health endpoints
router.use(generalLimiter);

/**
 * @swagger
 * tags:
 *   name: Health
 *   description: API health and monitoring endpoints
 */

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Basic health check
 *     description: Returns basic application health status and system information
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: OK
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     uptime:
 *                       type: number
 *                       description: Application uptime in seconds
 *                     version:
 *                       type: string
 *                       description: Application version
 *                     environment:
 *                       type: string
 *                       description: Current environment
 *                     memory:
 *                       type: object
 *                       description: Memory usage statistics
 *                     cpu:
 *                       type: object
 *                       description: CPU usage statistics
 */
router.get('/', healthCheck);

/**
 * @swagger
 * /api/health/detailed:
 *   get:
 *     summary: Detailed health check
 *     description: Returns comprehensive health status including dependencies
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application and dependencies are healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [UP, WARNING, DOWN]
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     responseTime:
 *                       type: string
 *                       description: Health check response time
 *                     version:
 *                       type: string
 *                     environment:
 *                       type: string
 *                     uptime:
 *                       type: string
 *                     checks:
 *                       type: object
 *                       properties:
 *                         database:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [UP, DOWN]
 *                             responseTime:
 *                               type: string
 *                             message:
 *                               type: string
 *                         memory:
 *                           type: object
 *                           properties:
 *                             status:
 *                               type: string
 *                               enum: [UP, WARNING]
 *                             usage:
 *                               type: object
 *                         externalServices:
 *                           type: object
 *       503:
 *         description: Application or dependencies are unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/detailed', detailedHealthCheck);

/**
 * @swagger
 * /api/health/live:
 *   get:
 *     summary: Liveness probe
 *     description: Simple endpoint to check if the application is alive (for Kubernetes liveness probes)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: alive
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/live', liveness);

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness probe
 *     description: Check if the application is ready to receive traffic (for Kubernetes readiness probes)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *       503:
 *         description: Application is not ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: not_ready
 *                 message:
 *                   type: string
 *                 checks:
 *                   type: object
 */
router.get('/ready', readiness);

/**
 * @swagger
 * /api/health/metrics:
 *   get:
 *     summary: Application metrics
 *     description: Returns detailed metrics for monitoring systems
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     uptime:
 *                       type: number
 *                     memory:
 *                       type: object
 *                       properties:
 *                         rss:
 *                           type: integer
 *                         heapTotal:
 *                           type: integer
 *                         heapUsed:
 *                           type: integer
 *                         external:
 *                           type: integer
 *                     cpu:
 *                       type: object
 *                       properties:
 *                         user:
 *                           type: integer
 *                         system:
 *                           type: integer
 *                     eventLoop:
 *                       type: object
 *                       properties:
 *                         delay:
 *                           type: number
 */
router.get('/metrics', metrics);

/**
 * @swagger
 * /api/health/performance:
 *   get:
 *     summary: Performance metrics
 *     description: Returns detailed performance and system metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     processMetrics:
 *                       type: object
 *                     systemMetrics:
 *                       type: object
 */
router.get('/performance', performance);

export default router;