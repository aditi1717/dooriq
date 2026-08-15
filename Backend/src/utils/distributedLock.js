import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';

/**
 * Mutual exclusion for scheduled maintenance work, backed by MongoDB.
 *
 * Why not just check NODE_APP_INSTANCE:
 *   - It only scopes to one machine. Two app servers each have an "instance 0",
 *     so every sweep would still run twice.
 *   - If that particular worker dies or is restarted mid-cycle, the job simply
 *     stops running and nothing else picks it up.
 *
 * With a lease, every worker on every host may attempt the job; exactly one wins
 * each cycle, and if the winner dies the lease expires and another worker takes
 * over on the next tick. Mongo is used rather than Redis because Redis is
 * optional in this deployment (REDIS_ENABLED=false) while Mongo always exists.
 */

const lockSchema = new mongoose.Schema(
    {
        // The lock name is the primary key, which is what makes acquisition a
        // single atomic upsert rather than a read-then-write race.
        _id: { type: String, required: true },
        owner: { type: String, required: true },
        acquiredAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
    },
    { collection: 'system_locks', versionKey: false },
);

// Safety net: abandoned leases are removed by Mongo even if a release is missed.
lockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SystemLock = mongoose.models.SystemLock || mongoose.model('SystemLock', lockSchema);

/** Identifies this process in lock documents; useful when debugging contention. */
const OWNER_ID = `${process.pid}:${process.env.NODE_APP_INSTANCE ?? 'solo'}:${randomUUID().slice(0, 8)}`;

/**
 * Lock persistence, isolated behind a tiny interface so the coordination logic
 * can be exercised without a live MongoDB.
 *
 * @param {{ findOneAndUpdate: Function, deleteOne: Function }} collection
 */
export const createMongoLockStore = (collection) => ({
    /**
     * Try to take a lease. Returns true only for the single caller that wins.
     *
     * The filter matches only a free or expired lease. When another owner holds a
     * live one the filter misses, so the upsert tries to insert a second document
     * with the same `_id` and Mongo raises duplicate key (11000). That collision
     * IS the "someone else has it" answer, and it is atomic - so it is translated
     * into a plain `false` rather than surfaced as an error. Every cycle, all but
     * one worker take this path; treating it as a failure would mean a warning
     * per worker per cycle for the life of the process.
     */
    async acquire(name, ttlMs, owner) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);
        try {
            await collection.findOneAndUpdate(
                { _id: name, expiresAt: { $lte: now } },
                { $set: { owner, acquiredAt: now, expiresAt } },
                { upsert: true, new: true },
            );
            return true;
        } catch (err) {
            if (err?.code === 11000) return false; // held by a live owner
            throw err;
        }
    },

    /** Release a lease we own; a missed release simply expires. */
    async release(name, owner) {
        await collection.deleteOne({ _id: name, owner });
    },
});

export const mongoLockStore = createMongoLockStore(SystemLock);

/**
 * Run `task` if and only if this process can take the named lease.
 *
 * @param {string} name Lock identity, shared by all processes running this job.
 * @param {number} ttlMs Lease lifetime. Must exceed the task's worst-case
 *   runtime, otherwise a second worker may start while the first is still going.
 * @param {() => Promise<T>} task
 * @returns {Promise<{ ran: boolean, result?: T }>}
 */
export async function withLock(name, ttlMs, task, { store = mongoLockStore, owner = OWNER_ID } = {}) {
    let acquired = false;
    try {
        acquired = await store.acquire(name, ttlMs, owner);
    } catch (err) {
        // A lock-store failure must not take the job down permanently; skip this
        // cycle and try again on the next tick.
        logger.warn(`Lock acquisition failed for "${name}": ${err?.message || err}`);
        return { ran: false };
    }

    if (!acquired) return { ran: false };

    try {
        const result = await task();
        return { ran: true, result };
    } finally {
        // Always release, even if the task threw - otherwise the job would be
        // blocked until the lease expired.
        try {
            await store.release(name, owner);
        } catch (err) {
            logger.warn(`Failed to release lock "${name}": ${err?.message || err}`);
        }
    }
}

/**
 * Run an async job on a fixed cadence, safely.
 *
 * `setInterval` with an async callback fires on a wall clock and does not wait
 * for the previous run, so a job that occasionally takes longer than its period
 * starts overlapping itself and the overlap compounds. This schedules the next
 * run only after the previous one settles, and guards against re-entry.
 *
 * @returns {() => void} stop function
 */
export function scheduleRecurring(name, intervalMs, task, { lockTtlMs, run = withLock } = {}) {
    let stopped = false;
    let timer = null;
    let running = false;

    const ttl = Number(lockTtlMs) > 0 ? Number(lockTtlMs) : Math.max(intervalMs * 2, 60_000);

    const tick = async () => {
        // `running` is the local re-entrancy guard: even before the distributed
        // lease is consulted, this process must never start a second copy of a
        // job it is already executing.
        if (stopped || running) return;
        running = true;
        try {
            await run(name, ttl, task);
        } catch (err) {
            logger.error(`Scheduled job "${name}" failed: ${err?.message || err}`);
        } finally {
            running = false;
            if (!stopped) {
                timer = setTimeout(tick, intervalMs);
                // Don't hold the event loop open for a maintenance timer.
                if (typeof timer.unref === 'function') timer.unref();
            }
        }
    };

    // Stagger the first run so N workers starting together do not all contend
    // for the same lease in the same millisecond.
    const startupJitter = Math.floor(Math.random() * Math.min(intervalMs, 5000));
    timer = setTimeout(tick, startupJitter);
    if (typeof timer.unref === 'function') timer.unref();

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
