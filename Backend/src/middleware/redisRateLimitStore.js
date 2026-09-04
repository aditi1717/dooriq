import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * A Redis-backed store for express-rate-limit v7.
 *
 * The default store keeps counters in process memory, so the effective limit is
 * `configured max x number of processes` — today two API workers, so double —
 * and every deploy resets it. Scaling the API tier makes the gap worse, which
 * is the opposite of what a rate limit is for.
 *
 * Written against the existing `redis` client rather than pulling in
 * `rate-limit-redis`, so this needs no new dependency and no npm install on a
 * server we are not currently deploying to.
 *
 * Counting uses INCR plus a single PEXPIRE on first write, which is the cheap
 * fixed-window approach: one round trip per request, and the key expires by
 * itself. If Redis is unavailable the store fails OPEN — a rate limiter is a
 * guard rail, and taking the API down because the guard rail is unreachable
 * trades a small problem for a large one. Failures are logged, throttled to
 * one line a minute so an outage cannot itself flood the logs.
 */
export class RedisRateLimitStore {
    constructor({ prefix = 'rl:' } = {}) {
        this.prefix = prefix;
        this.windowMs = 60_000;
        this.lastErrorLoggedAt = 0;
    }

    /** express-rate-limit hands the resolved options here at startup. */
    init(options) {
        this.windowMs = options.windowMs;
    }

    key(k) {
        return `${this.prefix}${k}`;
    }

    noteFailure(err) {
        const now = Date.now();
        if (now - this.lastErrorLoggedAt < 60_000) return;
        this.lastErrorLoggedAt = now;
        logger.warn(`Rate limit store unavailable, failing open: ${err?.message || err}`);
    }

    async increment(key) {
        const resetTime = new Date(Date.now() + this.windowMs);
        try {
            const client = getRedisClient();
            if (!client) throw new Error('redis client not initialised');

            const redisKey = this.key(key);
            // Pipeline the INCR and the TTL read so this stays one round trip.
            const [hits, ttl] = await Promise.all([
                client.incr(redisKey),
                client.pTTL(redisKey),
            ]);

            // -1 means the key exists with no expiry: only possible on the
            // first increment, or if a previous PEXPIRE was lost.
            if (ttl < 0) await client.pExpire(redisKey, this.windowMs);

            return {
                totalHits: hits,
                resetTime: ttl > 0 ? new Date(Date.now() + ttl) : resetTime,
            };
        } catch (err) {
            this.noteFailure(err);
            // Fail open: report a single hit so the request is never blocked
            // by an infrastructure problem.
            return { totalHits: 1, resetTime };
        }
    }

    async decrement(key) {
        try {
            const client = getRedisClient();
            if (client) await client.decr(this.key(key));
        } catch (err) {
            this.noteFailure(err);
        }
    }

    async resetKey(key) {
        try {
            const client = getRedisClient();
            if (client) await client.del(this.key(key));
        } catch (err) {
            this.noteFailure(err);
        }
    }
}
