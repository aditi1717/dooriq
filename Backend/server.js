import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';

import app from './src/app.js';
import { config } from './src/config/env.js';
import { validateConfig } from './src/config/validateEnv.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { connectRedis, closeRedis } from './src/config/redis.js';
import { initSocket, initRedisEmitter } from './src/config/socket.js';
import { initializeQueues, closeBullMQConnection } from './src/queues/index.js';
import { expireExpiredOffers } from './src/modules/food/admin/services/admin.service.js';
import { syncExpiredFssaiNotifications } from './src/modules/food/restaurant/services/fssaiExpiry.service.js';

import { logger } from './src/utils/logger.js';
import { scheduleRecurring } from './src/utils/distributedLock.js';
import { initializeFirebaseRealtime } from './src/config/firebase.js';

const SHUTDOWN_TIMEOUT_MS = 10000;
const ORDER_EXPIRY_SWEEP_MS = 30 * 1000;
const OFFER_EXPIRY_SWEEP_MS = 5 * 60 * 1000;
const FSSAI_SWEEP_MS = 60 * 60 * 1000;

let server = null;
/** Stop functions for the recurring maintenance jobs. */
const stopMaintenanceJobs = [];

/** Set once shutdown has begun, so a throw mid-shutdown cannot restart it. */
let shuttingDown = false;

/**
 * Unhandled rejections no longer kill the process, so this counter is the only
 * signal that they are happening at all. Rising values mean a bug on a hot
 * path; alert on the rate, not the total.
 */
let unhandledRejectionCount = 0;
export const getUnhandledRejectionCount = () => unhandledRejectionCount;

const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, starting graceful shutdown`);
    if (!server) {
        process.exit(0);
        return;
    }
    server.close(async () => {
        try {
            await disconnectDB();
            await closeRedis();
            await closeBullMQConnection();
            stopMaintenanceJobs.forEach((stop) => {
                try { stop(); } catch { /* already stopped */ }
            });
            logger.info('Graceful shutdown complete');
            process.exit(0);
        } catch (err) {
            logger.error(`Shutdown error: ${err.message}`);
            process.exit(1);
        }
    });
    setTimeout(() => {
        logger.error('Shutdown timeout, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
};

const startServer = async () => {
    try {
        validateConfig();
        initializeFirebaseRealtime();

        // 1. Connect to Database (MongoDB)
        await connectDB();

        // 2. Connect Redis and initialize the emitter used by API controllers/workers
        if (config.redisEnabled) {
            await connectRedis();
            initRedisEmitter();
        }

        // 3. Create HTTP server from Express app and initialize Socket.IO
        const httpServer = http.createServer(app);
        await initSocket(httpServer);

        // 4. Watchdog: Recover stuck orders from previous run
        try {
            const { recoverStuckOrders } = await import('./src/modules/food/orders/services/order.service.js');
            await recoverStuckOrders();
        } catch (err) {
            logger.error(`Watchdog startup error: ${err.message}`);
        }

        // 5. Conditionally initialize BullMQ queues.
        // BullMQ requires Redis; skip queue bootstrap when Redis is disabled.
        if (config.bullmqEnabled && config.redisEnabled) {
            try {
                initializeQueues();
            } catch (err) {
                logger.error(`BullMQ initialization error (server continues): ${err.message}`);
            }
        } else if (config.bullmqEnabled && !config.redisEnabled) {
            logger.warn('BullMQ is enabled but Redis is disabled. Queue initialization skipped.');
        }

        app.post('/api/deploy', (req, res) => {
            const signature = req.headers['x-hub-signature-256'];
            const secret = 'mysecret123';

            const hash = 'sha256=' + crypto
                .createHmac('sha256', secret)
                .update(JSON.stringify(req.body))
                .digest('hex');

            if (signature !== hash) {
                return res.status(403).send('Unauthorized');
            }

            exec('cd ~ && ./deploy.sh', (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    return res.send('Deploy failed');
                }

                console.log(stdout);
                res.send('Deploy success');
            });
        });

        // 6. Start the HTTP server

        server = httpServer.listen(config.port, config.host, () => {
            logger.info(`Server running in ${config.nodeEnv} mode on ${config.host}:${config.port}`);
            console.log(`🌐 [URL] http://localhost:${config.port}`);
        });

        // ─── Maintenance sweeps ──────────────────────────────────────────────
        //
        // Each of these is a full-collection pass whose result is identical for
        // every process, so they must run once per cycle across the whole fleet -
        // not once per PM2 worker, and not once per server.
        //
        // `scheduleRecurring` handles all three hazards:
        //   - a Mongo lease so exactly one process per cycle does the work, and
        //     another takes over automatically if that process dies;
        //   - the next run is scheduled after the previous one finishes, so a
        //     slow sweep can never overlap itself;
        //   - startup jitter so workers booting together don't all contend.

        stopMaintenanceJobs.push(
            scheduleRecurring('maintenance:expire-offers', OFFER_EXPIRY_SWEEP_MS, async () => {
                await expireExpiredOffers();
            }),
        );

        stopMaintenanceJobs.push(
            scheduleRecurring('maintenance:fssai-expiry', FSSAI_SWEEP_MS, async () => {
                await syncExpiredFssaiNotifications();
            }),
        );

        // Auto-cancel orders the restaurant never accepted. This used to run
        // inline on every order list/detail read, putting a platform-wide scan
        // on the latency path of endpoints that clients poll every few seconds.
        stopMaintenanceJobs.push(
            scheduleRecurring('maintenance:order-expiry', ORDER_EXPIRY_SWEEP_MS, async () => {
                const { runOrderExpirySweep } = await import('./src/modules/food/orders/services/order.service.js');
                const expired = await runOrderExpirySweep();
                if (expired > 0) {
                    logger.info(`Order expiry sweep cancelled ${expired} unaccepted order(s)`);
                }
            }),
        );

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Handle server errors (like EADDRINUSE)
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${config.port} is already in use. Please kill the process or use a different port.`);
            } else {
                logger.error(`Server Error: ${err.message}`);
            }
            process.exit(1);
        });

        // A rejected promise is a bug in one request or one job. It is not
        // evidence that the process is unsound, so it must not take the process
        // down: exiting here drops every rider, customer and restaurant socket
        // at once, and the reconnect storm that follows lands on a process that
        // is about to hit the same bug again. That loop is what took the
        // platform out under live-tracking load — a single undefined
        // `logger.debug` on the GPS-ping path produced 874 fatal rejections.
        //
        // So: record it loudly and keep serving. `unhandledRejectionCount` is
        // exported for monitoring precisely because a silent handler is how
        // this class of bug hides.
        process.on('unhandledRejection', (err) => {
            unhandledRejectionCount += 1;
            const detail = err instanceof Error ? (err.stack || err.message) : String(err);
            logger.error(`Unhandled Rejection #${unhandledRejectionCount}: ${detail}`);
        });

        // An uncaught exception is different: the stack unwound through code
        // that was not expecting it, so state genuinely may be inconsistent and
        // Node's own guidance is to exit. Drain first rather than vanishing, so
        // clients see a clean close and reconnect on their own backoff instead
        // of all at once. `gracefulShutdown` carries its own re-entrancy guard,
        // so a throw *during* shutdown cannot restart it.
        process.on('uncaughtException', (err) => {
            const detail = err instanceof Error ? (err.stack || err.message) : String(err);
            logger.error(`Uncaught Exception: ${detail}`);
            if (config.nodeEnv !== 'production') return;
            gracefulShutdown('uncaughtException');
        });

    } catch (error) {
        logger.error(`Error starting server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

