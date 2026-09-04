import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { installProcessGuards } from '../../utils/processGuards.js';
import { getBullMQConnection } from '../connection.js';
import { TRACKING_QUEUE } from '../queue.constants.js';
import { processTrackingJob } from '../processors/tracking.processor.js';
import { connectRedis } from '../../config/redis.js';

// Installed before the worker boots, so a failure during bootstrap is
// reported rather than silently ending the process.
installProcessGuards({ label: 'worker-tracking' });

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
};

/**
 * The hot-to-cold sync reads rider positions back out of the `rider:locations:hot` and
 * `order:locations:hot` hashes via `getRedisClient()`. That client is only created by
 * `connectRedis()`, which this process never called — so every sync job returned
 * immediately and no location ever reached MongoDB. The BullMQ ioredis connection is a
 * different client and is not what the processor reads.
 */
const bootstrapRedisClient = async () => {
    if (!config.redisEnabled) {
        logger.warn('Tracking worker: Redis disabled, hot location sync will no-op.');
        return;
    }
    try {
        await connectRedis();
    } catch (err) {
        logger.error(`Tracking worker: Redis client bootstrap failed: ${err.message}`);
    }
};

const startTrackingWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Tracking worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Tracking worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    // Set concurrency to handle multiple high-frequency updates without blocking
    const worker = new Worker(TRACKING_QUEUE, processTrackingJob, {
        connection,
        concurrency: 10,
        defaultJobOptions
    });
    
    // Silence high-frequency logs in production for health but log major errors
    worker.on('completed', (job) => logger.debug(`Tracking job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.error(`Tracking job ${job?.id} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`Tracking worker error: ${err.message}`));
    
    logger.info('Tracking worker started (Scalable Real-time Persistence)');
    return worker;
};

const start = async () => {
    await bootstrapRedisClient();
    const worker = startTrackingWorker();
    if (worker) {
        const shutdown = async () => {
            logger.info('Graceful shutdown: closing tracking worker');
            await worker.close();
            process.exit(0);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
};


// A worker that fails to start must say so; the rejection would otherwise
// be silent and the queue would simply never be consumed.
start().catch((err) => {
    logger.error(`[worker-tracking] failed to start: ${err?.stack || err}`);
    process.exit(1);
});