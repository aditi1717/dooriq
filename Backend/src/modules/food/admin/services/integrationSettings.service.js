import { FoodIntegrationSettings } from '../models/integrationSettings.model.js';
import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { createTtlCache } from '../../../../utils/cache.js';

/**
 * Google Maps credentials, resolved from the database with the environment as
 * a fallback.
 *
 * The key is read on the geocoding and directions paths, which run per order,
 * so it is cached rather than fetched each time. A write invalidates the
 * writing worker immediately; other workers pick the change up within the TTL.
 * Sixty seconds is a deliberate trade: long enough that the read cost is
 * irrelevant, short enough that rotating a key takes effect while the admin is
 * still watching.
 */
const CACHE_KEY = 'integration:googleMaps';
const integrationCache = createTtlCache({ ttlMs: 60_000, maxEntries: 8, name: 'integrationSettings' });

/** Last 4 characters only — enough to tell two keys apart, useless if leaked. */
export const maskSecret = (value) => {
    const raw = String(value || '');
    if (!raw) return '';
    if (raw.length <= 4) return '****';
    return `${'*'.repeat(Math.min(raw.length - 4, 32))}${raw.slice(-4)}`;
};

const loadGoogleMapsKeys = async () => {
    const doc = await FoodIntegrationSettings.findOne().select('googleMaps').lean();

    const serverDb = String(doc?.googleMaps?.apiKey || '').trim();
    const serverEnv = String(config.googleMapsApiKey || '').trim();

    // The browser key falls back to the server key only when nothing else is
    // set, because a half-configured deployment showing a broken map is worse
    // than one reusing a key. Google will reject it if its restrictions do not
    // permit browser use, and the admin screen says so explicitly.
    const browserDb = String(doc?.googleMaps?.browserKey || '').trim();

    return {
        server: { key: serverDb || serverEnv, source: serverDb ? 'database' : (serverEnv ? 'environment' : 'unset') },
        browser: { key: browserDb, source: browserDb ? 'database' : 'unset' },
    };
};

/**
 * The Maps key to use for an outbound request.
 * @returns {Promise<string>} empty string when no key is configured anywhere
 */
export const getGoogleMapsApiKey = async () => {
    try {
        const resolved = await integrationCache.get(CACHE_KEY, loadGoogleMapsKeys);
        return resolved?.server?.key || '';
    } catch (err) {
        // A database problem must not take the Maps integration down when the
        // environment still holds a working key.
        logger.warn(`Integration settings unavailable, falling back to env Maps key: ${err?.message || err}`);
        return String(config.googleMapsApiKey || '').trim();
    }
};

/**
 * Browser key for the web apps. Unlike the server key this IS returned to
 * clients: it is embedded in the page either way, and Google's referrer
 * restriction is what protects it.
 */
export const getGoogleMapsBrowserKey = async () => {
    try {
        const resolved = await integrationCache.get(CACHE_KEY, loadGoogleMapsKeys);
        return resolved?.browser?.key || '';
    } catch (err) {
        logger.warn(`Integration settings unavailable, no browser Maps key: ${err?.message || err}`);
        return '';
    }
};

/** Where the active keys came from, for the admin screen. Never the key itself. */
export const getGoogleMapsKeyStatus = async () => {
    const doc = await FoodIntegrationSettings.findOne().select('googleMaps').lean();
    const fromDb = String(doc?.googleMaps?.apiKey || '').trim();
    const fromEnv = String(config.googleMapsApiKey || '').trim();
    const browserDb = String(doc?.googleMaps?.browserKey || '').trim();

    return {
        configured: Boolean(fromDb || fromEnv),
        source: fromDb ? 'database' : (fromEnv ? 'environment' : 'unset'),
        maskedKey: maskSecret(fromDb || fromEnv),
        canOverrideEnv: true,

        browserConfigured: Boolean(browserDb),
        browserSource: browserDb ? 'database' : 'unset',
        browserMaskedKey: maskSecret(browserDb),

        updatedAt: doc?.googleMaps?.updatedAt || null,
        updatedBy: doc?.googleMaps?.updatedBy || null,
    };
};

/**
 * Store a new key, or clear it with an empty string to fall back to the
 * environment again.
 */
export const setGoogleMapsApiKey = async (apiKey, adminId = null, field = 'apiKey') => {
    const value = String(apiKey ?? '').trim();
    const path = field === 'browserKey' ? 'googleMaps.browserKey' : 'googleMaps.apiKey';

    await FoodIntegrationSettings.findOneAndUpdate(
        { key: 'global' },
        {
            $set: {
                [path]: value,
                'googleMaps.updatedAt': new Date(),
                'googleMaps.updatedBy': adminId || null,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    integrationCache.delete(CACHE_KEY);
    logger.info(
        value
            ? `Google Maps API key updated by admin ${adminId || 'unknown'} (${maskSecret(value)})`
            : `Google Maps API key cleared by admin ${adminId || 'unknown'}; falling back to environment`,
    );

    return getGoogleMapsKeyStatus();
};

/** Exposed so a caller can force a re-read after an external change. */
export const invalidateIntegrationCache = () => integrationCache.delete(CACHE_KEY);
