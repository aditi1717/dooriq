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

const loadGoogleMapsKey = async () => {
    const doc = await FoodIntegrationSettings.findOne().select('googleMaps').lean();
    const fromDb = String(doc?.googleMaps?.apiKey || '').trim();
    if (fromDb) return { key: fromDb, source: 'database' };

    const fromEnv = String(config.googleMapsApiKey || '').trim();
    return { key: fromEnv, source: fromEnv ? 'environment' : 'unset' };
};

/**
 * The Maps key to use for an outbound request.
 * @returns {Promise<string>} empty string when no key is configured anywhere
 */
export const getGoogleMapsApiKey = async () => {
    try {
        const resolved = await integrationCache.get(CACHE_KEY, loadGoogleMapsKey);
        return resolved?.key || '';
    } catch (err) {
        // A database problem must not take the Maps integration down when the
        // environment still holds a working key.
        logger.warn(`Integration settings unavailable, falling back to env Maps key: ${err?.message || err}`);
        return String(config.googleMapsApiKey || '').trim();
    }
};

/** Where the active key came from, for the admin screen. Never the key itself. */
export const getGoogleMapsKeyStatus = async () => {
    const doc = await FoodIntegrationSettings.findOne().select('googleMaps').lean();
    const fromDb = String(doc?.googleMaps?.apiKey || '').trim();
    const fromEnv = String(config.googleMapsApiKey || '').trim();

    return {
        configured: Boolean(fromDb || fromEnv),
        source: fromDb ? 'database' : (fromEnv ? 'environment' : 'unset'),
        maskedKey: maskSecret(fromDb || fromEnv),
        canOverrideEnv: true,
        updatedAt: doc?.googleMaps?.updatedAt || null,
        updatedBy: doc?.googleMaps?.updatedBy || null,
    };
};

/**
 * Store a new key, or clear it with an empty string to fall back to the
 * environment again.
 */
export const setGoogleMapsApiKey = async (apiKey, adminId = null) => {
    const value = String(apiKey ?? '').trim();

    await FoodIntegrationSettings.findOneAndUpdate(
        { key: 'global' },
        {
            $set: {
                'googleMaps.apiKey': value,
                'googleMaps.updatedAt': new Date(),
                'googleMaps.updatedBy': adminId || null,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    integrationCache.del(CACHE_KEY);
    logger.info(
        value
            ? `Google Maps API key updated by admin ${adminId || 'unknown'} (${maskSecret(value)})`
            : `Google Maps API key cleared by admin ${adminId || 'unknown'}; falling back to environment`,
    );

    return getGoogleMapsKeyStatus();
};

/** Exposed so a caller can force a re-read after an external change. */
export const invalidateIntegrationCache = () => integrationCache.del(CACHE_KEY);
