import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { installProcessGuards } from '../../utils/processGuards.js';
import { getBullMQConnection } from '../connection.js';
import { ORDER_QUEUE } from '../queue.constants.js';
import { processOrderJob } from '../processors/order.processor.js';
import { connectRedis } from '../../config/redis.js';
import { initRedisEmitter } from '../../config/socket.js';

// Installed before the worker boots, so a failure during bootstrap is
// reported rather than silently ending the process.
installProcessGuards({ label: 'worker-order' });

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
};

/**
 * Dispatch retries run in this process and emit `new_order`, `order_claimed` and
 * `order_cancelled` to rider rooms. Without a Redis emitter, `getIO()` finds no
 * Socket.IO server here and falls back to a no-op stub, so every one of those emits
 * was silently discarded — retry broadcasts survived on Firebase and FCM alone.
 * The BullMQ connection is a separate ioredis client and does not cover this.
 */
const bootstrapSocketEmitter = async () => {
    if (!config.redisEnabled) {
        logger.warn('Order worker: Redis disabled, socket emits from queued jobs will be dropped.');
        return;
    }
    try {
        await connectRedis();
        initRedisEmitter();
    } catch (err) {
        logger.error(`Order worker: Redis emitter bootstrap failed: ${err.message}`);
    }
};

const startOrderWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Order worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Order worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    const worker = new Worker(ORDER_QUEUE, processOrderJob, {
        connection,
        concurrency: 5,
        defaultJobOptions
    });
    worker.on('completed', (job) => logger.info(`Order job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.error(`Order job ${job?.id} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`Order worker error: ${err.message}`));
    logger.info('Order worker started');
    return worker;
};

const start = async () => {
    await bootstrapSocketEmitter();
    const worker = startOrderWorker();
    if (worker) {
        const shutdown = async () => {
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
    logger.error(`[worker-order] failed to start: ${err?.stack || err}`);
    process.exit(1);
});