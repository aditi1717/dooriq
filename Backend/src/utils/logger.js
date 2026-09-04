/**
 * Minimal leveled logger.
 *
 * `debug` was being called in several places (socket handlers, the tracking
 * worker) without ever being defined, which threw "logger.debug is not a
 * function" - and because two of those call sites sit inside catch blocks, the
 * failure surfaced as an unrelated crash rather than a missing log line.
 *
 * Debug output is suppressed in production unless LOG_LEVEL=debug, so enabling
 * it is a config change rather than a redeploy.
 */
const isProduction = process.env.NODE_ENV === 'production';
const debugEnabled = String(process.env.LOG_LEVEL || '').toLowerCase() === 'debug' || !isProduction;

/**
 * Exported so hot-path callers can skip building a log payload that would be
 * thrown away. Serialising the argument to `logger.debug` still costs a
 * `JSON.stringify` even when the line is suppressed, which is measurable on
 * per-GPS-ping call sites.
 */
export const isDebugEnabled = () => debugEnabled;

/** Accept strings, Errors, and objects without emitting "[object Object]". */
const format = (msg) => {
    if (typeof msg === 'string') return msg;
    if (msg instanceof Error) return msg.stack || msg.message;
    try {
        return JSON.stringify(msg);
    } catch {
        return String(msg);
    }
};

const stamp = () => new Date().toLocaleTimeString();

export const logger = {
    info: (msg) => console.log(`✅ [INFO] ${stamp()}: ${format(msg)}`),
    error: (msg) => console.error(`❌ [ERROR] ${stamp()}: ${format(msg)}`),
    warn: (msg) => console.warn(`⚠️ [WARN] ${stamp()}: ${format(msg)}`),
    debug: (msg) => {
        if (!debugEnabled) return;
        console.log(`🐞 [DEBUG] ${stamp()}: ${format(msg)}`);
    },
};
