import http from 'http';
import express from 'express';

import { config } from './src/config/env.js';
import { validateConfig } from './src/config/validateEnv.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { connectRedis, closeRedis } from './src/config/redis.js';
import { initSocket } from './src/config/socket.js';
import { closeBullMQConnection } from './src/queues/index.js';
import { logger } from './src/utils/logger.js';
import { installProcessGuards } from './src/utils/processGuards.js';
import { initializeFirebaseRealtime } from './src/config/firebase.js';

const SHUTDOWN_TIMEOUT_MS = 10000;
let server = null;

let shuttingDown = false;

const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, starting socket server shutdown`);
    if (!server) {
        process.exit(0);
        return;
    }

    server.close(async () => {
        try {
            await disconnectDB();
            await closeRedis();
            await closeBullMQConnection();
            logger.info('Socket server shutdown complete');
            process.exit(0);
        } catch (err) {
            logger.error(`Socket server shutdown error: ${err.message}`);
            process.exit(1);
        }
    });

    setTimeout(() => {
        logger.error('Socket server shutdown timeout, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
};

const startSocketServer = async () => {
    try {
        validateConfig();
        initializeFirebaseRealtime();

        await connectDB();

        if (config.redisEnabled) {
            await connectRedis();
        }

        const app = express();
        app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                service: 'socket',
                redisEnabled: config.redisEnabled,
                socketPort: config.socketPort
            });
        });

        const httpServer = http.createServer(app);
        await initSocket(httpServer);

        server = httpServer.listen(config.socketPort, config.host, () => {
            logger.info(`Socket server running in ${config.nodeEnv} mode on ${config.host}:${config.socketPort}`);
            console.log(`🌐 [Socket URL] http://localhost:${config.socketPort}`);
        });

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Socket port ${config.socketPort} is already in use.`);
            } else {
                logger.error(`Socket server error: ${err.message}`);
            }
            process.exit(1);
        });

        installProcessGuards({ label: 'socket', onFatal: gracefulShutdown });
    } catch (error) {
        logger.error(`Error starting socket server: ${error.message}`);
        process.exit(1);
    }
};

startSocketServer();
