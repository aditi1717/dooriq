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
import { installProcessGuards } from './src/utils/processGuards.js';
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

        // ─── Deploy webhook ──────────────────────────────────────────────────
        //
        // This endpoint runs a shell script as root, so it is registered only
        // when a secret is explicitly configured. It previously shipped with
        // the secret 'mysecret123' hardcoded in the repository, which meant
        // anyone able to read the source could trigger a production deploy.
        //
        // Three things changed: the secret comes from the environment, the HMAC
        // is computed over the raw request body (GitHub signs the bytes it
        // sent, not a re-serialisation of the parsed object — the old version
        // could not have validated a real GitHub signature), and the comparison
        // is timing-safe.
        if (config.deployWebhookSecret) {
            app.post('/api/deploy', (req, res) => {
                const signature = req.headers['x-hub-signature-256'];
                if (!signature || !req.rawBody) {
                    logger.warn('Deploy webhook: missing signature or raw body');
                    return res.status(400).send('Bad request');
                }

                const expected = 'sha256=' + crypto
                    .createHmac('sha256', config.deployWebhookSecret)
                    .update(req.rawBody)
                    .digest('hex');

                // timingSafeEqual throws on a length mismatch, so compare lengths first.
                const a = Buffer.from(signature);
                const b = Buffer.from(expected);
                if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
                    logger.warn('Deploy webhook: signature verification failed');
                    return res.status(403).send('Unauthorized');
                }

                logger.info('Deploy webhook: signature verified, running deploy script');
                exec('cd ~ && ./deploy.sh', { timeout: 10 * 60 * 1000 }, (err, stdout) => {
                    if (err) {
                        logger.error(`Deploy webhook: script failed: ${err.message}`);
                        return res.status(500).send('Deploy failed');
                    }
                    logger.info(`Deploy webhook: complete\n${stdout}`);
                    res.send('Deploy success');
                });
            });
            logger.info('Deploy webhook enabled at POST /api/deploy');
        } else {
            logger.warn('Deploy webhook disabled: DEPLOY_WEBHOOK_SECRET is not set');
        }

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

        installProcessGuards({ label: 'api', onFatal: gracefulShutdown });

    } catch (error) {
        logger.error(`Error starting server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

