import { getMaintenanceState } from '../modules/food/admin/services/maintenance.service.js';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { logger } from '../utils/logger.js';

/**
 * Returns 503 for everything while maintenance mode is active.
 *
 * The hard requirement is that turning maintenance ON must never take away the
 * ability to turn it OFF. Two independent things guarantee that:
 *
 *   1. The admin API and the auth routes are exempt by path, so they work even
 *      for a request carrying no token at all. An admin can always log in and
 *      reach the switch.
 *   2. Any request whose bearer token says ADMIN is let through, so the admin
 *      panel keeps working as a whole rather than just its settings screen.
 *
 * Belt and braces on purpose: (2) alone would fail if the token had expired
 * mid-outage, and (1) alone would leave an admin looking at a dead dashboard.
 */

/**
 * Exempt path prefixes, matched against the path *after* the `/api` mount.
 *
 * Deliberately narrow. Webhooks are included because a payment provider
 * retrying a capture during a 20-minute window would otherwise leave orders
 * paid-but-unrecorded, which is worse than the outage.
 */
const EXEMPT_PREFIXES = [
    '/v1/food/admin', // the switch itself, plus the whole admin panel
    '/v1/food/auth', // admin (and everyone's) login
    '/v1/auth',
    '/v1/food/maintenance', // the status endpoint the maintenance screen reads
    '/v1/payments/webhook', // provider callbacks must not be dropped
    '/health',
];

const isExemptPath = (path) => EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/** ADMIN, decided from the bearer token without requiring one. */
const isAdminRequest = (req) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return false;
    try {
        return verifyAccessToken(header.slice(7))?.role === 'ADMIN';
    } catch {
        // An expired or malformed token is simply "not a known admin" here.
        // The exempt paths above are what keeps them able to log in again.
        return false;
    }
};

export const maintenanceGuard = async (req, res, next) => {
    try {
        if (isExemptPath(req.path)) return next();

        const state = await getMaintenanceState();
        if (!state.active) return next();

        if (isAdminRequest(req)) {
            // Useful when an admin reports "the site looks fine to me".
            res.setHeader('X-Maintenance-Bypass', 'admin');
            return next();
        }

        // 503 + Retry-After is the correct answer for a planned outage: it tells
        // crawlers and clients this is temporary rather than a permanent error,
        // so rankings and retry logic behave sensibly.
        if (state.endsAt) {
            const seconds = Math.max(1, Math.ceil((state.endsAt.getTime() - Date.now()) / 1000));
            res.setHeader('Retry-After', String(seconds));
        }
        res.setHeader('Cache-Control', 'no-store');

        return res.status(503).json({
            success: false,
            maintenance: true,
            message: state.message,
            startsAt: state.startsAt,
            endsAt: state.endsAt,
        });
    } catch (err) {
        // Fail open. A bug or a database blip in here must not take the site
        // down — that would be the guard causing the outage it exists to
        // announce.
        logger.error(`Maintenance guard error, allowing request: ${err?.message || err}`);
        return next();
    }
};
