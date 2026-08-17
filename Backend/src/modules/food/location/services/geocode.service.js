/**
 * Server-side reverse geocoding.
 *
 * Why this exists: the browser used to call
 * `maps.googleapis.com/maps/api/geocode/json?...&key=…` directly. Google's
 * web-service endpoints do not honour HTTP-referrer restrictions — only IP
 * restrictions, which a browser cannot satisfy — so that call forced the Maps key
 * to be left completely unrestricted, visible in the bundle and in every network
 * trace, and therefore spendable by anyone who copied it.
 *
 * Moving the call here means the browser key can be locked to referrers + the
 * Maps JS API, while this server-side key can be locked to the server's IP.
 * The cache is a bonus: a fixed coordinate's address never really changes.
 */

import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { createTtlCache } from '../../../../utils/cache.js';
import { FoodGeocodeCache } from '../models/geocodeCache.model.js';

/** ~11 m of precision. Finer than this buys nothing and destroys the hit rate. */
const COORD_PRECISION = 4;

/** Hot in-process layer in front of Mongo, for repeated lookups of one point. */
const hotCache = createTtlCache({ ttlMs: 60_000, maxEntries: 2000, name: 'geocode' });

/**
 * Drop the in-process layer, forcing the next read through to Mongo.
 *
 * Useful operationally after purging the cache collection, and it makes the
 * persistent layer testable — otherwise the hot cache masks it entirely.
 */
export function invalidateGeocodeHotCache(lat, lng) {
    if (lat === undefined || lng === undefined) {
        hotCache.clear?.();
        return;
    }
    hotCache.delete(buildGeocodeKey(lat, lng));
}

export function buildGeocodeKey(lat, lng) {
    return `${Number(lat).toFixed(COORD_PRECISION)},${Number(lng).toFixed(COORD_PRECISION)}`;
}

export function isValidCoordinate(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    return (
        Number.isFinite(a) && Number.isFinite(b) &&
        a >= -90 && a <= 90 && b >= -180 && b <= 180
    );
}

/**
 * Map a Google Geocoding result onto the exact shape the web client already
 * expects. Kept byte-compatible with the previous in-browser implementation so
 * swapping the transport changes nothing downstream.
 */
function normalizeGoogleResult(result) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    const pick = (...types) =>
        components.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || '';

    const area =
        pick('sublocality_level_1', 'sublocality', 'neighborhood') ||
        pick('locality');
    const city = pick('locality') || pick('administrative_area_level_2') || 'Unknown City';
    const state = pick('administrative_area_level_1');
    const country = pick('country');
    const formatted = result?.formatted_address || `${city}, ${state}`.trim();

    return {
        city,
        state,
        country,
        area,
        address: formatted,
        formattedAddress: formatted,
    };
}

async function fetchFromGoogle(lat, lng) {
    const apiKey = config.googleMapsApiKey;
    if (!apiKey) {
        logger.warn('Reverse geocode skipped: GOOGLE_MAPS_API_KEY not configured.');
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const url =
            'https://maps.googleapis.com/maps/api/geocode/json' +
            `?latlng=${encodeURIComponent(lat)},${encodeURIComponent(lng)}` +
            `&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (data?.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) {
            // OVER_QUERY_LIMIT / REQUEST_DENIED are worth shouting about — they are
            // exactly the states that made a "working" key silently stop working.
            const level = ['OVER_QUERY_LIMIT', 'REQUEST_DENIED'].includes(data?.status) ? 'error' : 'warn';
            logger[level](
                `Reverse geocode returned ${data?.status || 'no status'}${data?.error_message ? `: ${data.error_message}` : ''}`,
            );
            return null;
        }

        return normalizeGoogleResult(data.results[0]);
    } catch (err) {
        logger.warn(`Reverse geocode request failed: ${err?.message || err}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Reverse geocode a coordinate, served from cache when possible.
 *
 * Returns null when the address genuinely cannot be resolved — callers keep
 * their own fallback chain rather than being handed a fabricated address.
 *
 * @returns {Promise<{city,state,country,area,address,formattedAddress,cached:boolean}|null>}
 */
export async function reverseGeocode(lat, lng) {
    if (!isValidCoordinate(lat, lng)) return null;

    const key = buildGeocodeKey(lat, lng);

    return hotCache.get(key, async () => {
        try {
            const cached = await FoodGeocodeCache.findOne({ key }).lean();
            if (cached) {
                // Fire-and-forget: hit counting must never delay the response.
                FoodGeocodeCache.updateOne({ key }, { $inc: { hits: 1 } }).catch(() => {});
                return {
                    city: cached.city,
                    state: cached.state,
                    country: cached.country,
                    area: cached.area,
                    address: cached.address,
                    formattedAddress: cached.formattedAddress,
                    cached: true,
                };
            }
        } catch (err) {
            // A cache read failure must not stop us answering.
            logger.warn(`Geocode cache read failed: ${err?.message || err}`);
        }

        const fresh = await fetchFromGoogle(lat, lng);
        if (!fresh) return null;

        try {
            await FoodGeocodeCache.updateOne(
                { key },
                {
                    $set: {
                        key,
                        lat: Number(Number(lat).toFixed(COORD_PRECISION)),
                        lng: Number(Number(lng).toFixed(COORD_PRECISION)),
                        provider: 'google',
                        ...fresh,
                    },
                },
                { upsert: true },
            );
        } catch (err) {
            logger.warn(`Geocode cache write failed: ${err?.message || err}`);
        }

        return { ...fresh, cached: false };
    });
}
