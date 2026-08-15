import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Connection pool sizing.
 *
 * PM2 runs the API in cluster mode, so every worker process opens its own pool
 * and the cluster-wide connection count is `maxPoolSize x worker count`. The
 * default (100 per process) can exhaust the Atlas connection limit on a
 * multi-core box, so the cap is explicit and overridable per deployment.
 */
const MAX_POOL_SIZE = Number(process.env.MONGO_MAX_POOL_SIZE || 25);
const MIN_POOL_SIZE = Number(process.env.MONGO_MIN_POOL_SIZE || 5);

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.mongodbUri, {
            maxPoolSize: MAX_POOL_SIZE,
            minPoolSize: MIN_POOL_SIZE,
            // Fail fast instead of letting requests hang when a node is unreachable.
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            // Recycle idle sockets so the pool does not sit on dead connections.
            maxIdleTimeMS: 60000,
            // Reads are latency-sensitive; prefer the primary but tolerate lag.
            retryWrites: true,
            retryReads: true,
        });
        logger.info(
            `MongoDB connected: ${conn.connection.host} (pool ${MIN_POOL_SIZE}-${MAX_POOL_SIZE})`,
        );

        mongoose.connection.on('error', (err) => {
            logger.error(`MongoDB connection error: ${err.message}`);
        });
        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected; driver will attempt to reconnect');
        });
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Close MongoDB connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};
