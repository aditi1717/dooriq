import { logger } from './logger.js';
import { config } from '../config/env.js';

/**
 * Process-level crash guards, shared by every entry point: the API server, the
 * socket server, and each queue worker.
 *
 * This exists because the three entry points previously carried three separate
 * copies of the same handler, and the workers carried none at all — so a bug
 * that was survivable in one process was fatal in another, and nobody could
 * tell which without reading all eight files.
 *
 * The policy:
 *
 *   unhandledRejection — log and keep running. A rejected promise is a bug in
 *   one request or one job, not evidence that the process is unsound. Exiting
 *   drops every connected socket at once, and the reconnect storm that follows
 *   lands on a process about to hit the same bug again. That loop is what took
 *   the platform down under live-tracking load: a single undefined
 *   `logger.debug` on the GPS-ping path produced 874 fatal rejections.
 *
 *   uncaughtException — log and exit, because the stack unwound through code
 *   that was not expecting it and state may genuinely be inconsistent. Where
 *   the caller supplies `onFatal`, drain through it first so clients close
 *   cleanly and reconnect on their own backoff instead of simultaneously.
 */

let unhandledRejectionCount = 0;

/** Total unhandled rejections seen by this process. Alert on the rate. */
export const getUnhandledRejectionCount = () => unhandledRejectionCount;

const describe = (err) => (err instanceof Error ? (err.stack || err.message) : String(err));

/**
 * @param {object}   options
 * @param {string}   options.label     Process name used in log lines, e.g. 'socket'.
 * @param {Function} [options.onFatal] Async drain to run before exiting on an
 *                                     uncaught exception. Must be re-entrant.
 */
export const installProcessGuards = ({ label, onFatal } = {}) => {
    const tag = label ? `[${label}] ` : '';

    process.on('unhandledRejection', (err) => {
        unhandledRejectionCount += 1;
        logger.error(`${tag}Unhandled Rejection #${unhandledRejectionCount}: ${describe(err)}`);
    });

    process.on('uncaughtException', (err) => {
        logger.error(`${tag}Uncaught Exception: ${describe(err)}`);
        if (config.nodeEnv !== 'production') return;
        if (typeof onFatal === 'function') onFatal('uncaughtException');
        else process.exit(1);
    });
};
