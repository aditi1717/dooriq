/**
 * HTTP cache-control headers for public, non-personalised GET endpoints.
 *
 * Express already emits ETags, which is why the access log is full of 304s.
 * A 304 still costs a full round-trip: DNS/TLS reuse aside, the client asks and
 * the server answers on every single navigation. Without a `Cache-Control`
 * header the browser has no freshness lifetime, so it must revalidate.
 *
 * Adding an explicit max-age lets the browser serve repeat reads from its own
 * cache with zero network, and `stale-while-revalidate` keeps the UI instant
 * while a background refresh happens. Static config (banners, settings, zone
 * lookups) is the ideal candidate: identical for every user and rarely changed.
 *
 * Only ever attach this to responses that are identical for all callers.
 * Anything derived from req.user must use `noStore` instead.
 */

/**
 * @param {number} maxAgeSeconds How long a client may reuse the response without asking.
 * @param {{ staleWhileRevalidate?: number, scope?: 'public'|'private' }} [options]
 */
export const httpCache = (maxAgeSeconds = 60, options = {}) => {
    const maxAge = Math.max(0, Math.floor(Number(maxAgeSeconds) || 0));
    const swr = Math.max(0, Math.floor(Number(options.staleWhileRevalidate ?? maxAge) || 0));
    const scope = options.scope === 'private' ? 'private' : 'public';

    const value = swr > 0
        ? `${scope}, max-age=${maxAge}, stale-while-revalidate=${swr}`
        : `${scope}, max-age=${maxAge}`;

    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        // Headers must be set before the body is sent, but the status code is
        // only known at that point - so decide at write time.
        const applyHeader = () => {
            if (res.headersSent) return;
            if (res.statusCode >= 200 && res.statusCode < 400) {
                if (!res.getHeader('Cache-Control')) {
                    res.setHeader('Cache-Control', value);
                }
            } else {
                res.setHeader('Cache-Control', 'no-store');
            }
        };

        const originalJson = res.json.bind(res);
        res.json = (body) => {
            applyHeader();
            return originalJson(body);
        };

        const originalSend = res.send.bind(res);
        res.send = (body) => {
            applyHeader();
            return originalSend(body);
        };

        next();
    };
};

/**
 * Explicitly opt a route out of caching. Use on anything personalised
 * (orders, profile, notifications, wallet) so no proxy or browser retains it.
 */
export const noStore = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
};

/**
 * Safety net for every other API response.
 *
 * A response with no `Cache-Control` at all is not automatically private: the
 * spec lets a browser apply heuristic freshness, so authenticated payloads
 * (orders, profile, wallet) could be reused from disk after logout or by the
 * next person on a shared device.
 *
 * The header used here is `private, no-cache`, not `no-store`:
 *
 *   no-cache  -> the client may store the response but MUST revalidate before
 *                every reuse. A revalidation without a valid token gets 401, so
 *                stale authenticated data is never shown.
 *   no-store  -> the client may not store it at all, which also means it has no
 *                ETag to send back. Every poll then transfers the full body.
 *
 * That distinction matters a lot here: the order list and tracking screens poll
 * every 8-20 seconds, and almost every poll is unchanged. With `no-cache` those
 * become 304s with an empty body; with `no-store` they would all be full 200s.
 *
 * Use the `noStore` middleware explicitly for genuinely sensitive payloads.
 *
 * Route-level `httpCache` still wins, because its response wrapper is installed
 * later and therefore runs first.
 */
export const defaultPrivateCache = (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        if (!res.headersSent && !res.getHeader('Cache-Control')) {
            res.setHeader('Cache-Control', 'private, no-cache');
        }
        return originalJson(body);
    };
    next();
};

/** Common presets, so TTLs stay consistent across route files. */
export const CACHE_PRESETS = {
    /** Menus, restaurant lists - changes when a restaurant edits something. */
    catalog: () => httpCache(60, { staleWhileRevalidate: 300 }),
    /** Admin-managed config: settings, banners, icons, landing content. */
    config: () => httpCache(120, { staleWhileRevalidate: 600 }),
    /** Zone polygons and geo lookups - effectively static. */
    geo: () => httpCache(300, { staleWhileRevalidate: 1800 }),
};
