import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { RedisRateLimitStore } from './redisRateLimitStore.js';

/**
 * Counters live in Redis so the limit is cluster-wide. With the default
 * in-memory store each process keeps its own tally, so the real limit is the
 * configured value times the number of API workers, and every deploy clears it.
 *
 * The two limiters get distinct prefixes: they have different windows and
 * different key shapes, so sharing a namespace would let one consume the
 * other's budget.
 */
const makeStore = (prefix) => (config.redisEnabled ? new RedisRateLimitStore({ prefix }) : undefined);

const authWindowMs = config.authRateLimitWindowMinutes * 60 * 1000;
const privateWindowMs = config.rateLimitWindowMinutes * 60 * 1000;

/**
 * Category A — Authentication APIs Limiter
 * Applied on authentication endpoints (login, verify-otp, resend-otp, forgot-password, etc.)
 */
export const authRateLimiter = rateLimit({
    windowMs: authWindowMs,
    max: config.authRateLimitMax,
    store: makeStore('rl:auth:'),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !config.rateLimitEnabled,
    handler: (req, res, _next, _options) => {
        logger.warn('Rate limit exceeded [Category A - Auth API]', {
            timestamp: new Date().toISOString(),
            ip: req.ip,
            route: req.originalUrl || req.url,
            method: req.method,
            userId: req.user?.userId || req.user?._id || req.user?.id || null,
            userAgent: req.get('user-agent') || ''
        });
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        });
    }
});

/**
 * Category C — Private APIs Limiter
 * Applied AFTER authentication middleware.
 * Combined rate limit key: <User_ID>:<Real_Client_IP>
 */
export const privateRateLimiter = rateLimit({
    windowMs: privateWindowMs,
    max: config.nodeEnv === 'development' ? config.rateLimitDevMaxRequests : config.rateLimitMaxRequests,
    store: makeStore('rl:private:'),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !config.rateLimitEnabled,
    keyGenerator: (req) => {
        const userId = req.user?.userId || req.user?._id || req.user?.id || 'anonymous';
        return `${userId}:${req.ip}`;
    },
    handler: (req, res, _next, _options) => {
        logger.warn('Rate limit exceeded [Category C - Private API]', {
            timestamp: new Date().toISOString(),
            ip: req.ip,
            route: req.originalUrl || req.url,
            method: req.method,
            userId: req.user?.userId || req.user?._id || req.user?.id || null,
            userAgent: req.get('user-agent') || ''
        });
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        });
    }
});

// Alias for backwards compatibility
export const apiRateLimiter = privateRateLimiter;


