import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { createTtlCache } from '../../../../utils/cache.js';

/**
 * Road distance/duration between two fixed points does not change minute to
 * minute, but the same pair was previously re-requested by every dispatch
 * attempt and every re-broadcast of the same order.
 *
 * Keyed on both endpoints rounded to ~11 m. In-flight requests are shared by
 * the cache's single-flight behaviour, so concurrent dispatches for the same
 * restaurant→customer pair produce one billed request instead of N.
 *
 * 10 minutes: long enough to cover an order's whole dispatch lifecycle, short
 * enough that a route is never wildly stale.
 */
const routeCache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 1000, name: 'driving-route' });

const routeKey = (origin, destination) =>
    `${Number(origin.lat).toFixed(4)},${Number(origin.lng).toFixed(4)}` +
    `|${Number(destination.lat).toFixed(4)},${Number(destination.lng).toFixed(4)}`;

/**
 * Fetches driving route metrics from Google Directions API.
 * Call sparingly (for example once per order pricing / dispatch cycle).
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @returns {Promise<{ polyline: string, distanceMeters: number|null, durationSeconds: number|null, distanceKm: number|null }>}
 */
export async function fetchDrivingRoute(origin, destination) {
    const empty = {
        polyline: '',
        distanceMeters: null,
        durationSeconds: null,
        distanceKm: null,
    };

    const apiKey = config.googleMapsApiKey;
    if (!apiKey) {
        logger.warn('Google Maps API key missing. Driving route fetch skipped.');
        return empty;
    }

    if (
        !origin ||
        !destination ||
        !Number.isFinite(Number(origin.lat)) ||
        !Number.isFinite(Number(origin.lng)) ||
        !Number.isFinite(Number(destination.lat)) ||
        !Number.isFinite(Number(destination.lng))
    ) {
        return empty;
    }

    // Served from cache when the same pair was resolved recently.
    return routeCache.get(routeKey(origin, destination), () =>
        requestDrivingRoute(origin, destination, empty),
    );
}

async function requestDrivingRoute(origin, destination, empty) {
    const apiKey = config.googleMapsApiKey;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const originStr = `${origin.lat},${origin.lng}`;
        const destStr = `${destination.lat},${destination.lng}`;
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&mode=driving&key=${apiKey}`;

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json();

        if (data.status === 'OK' && data.routes?.length > 0) {
            const route = data.routes[0];
            const legs = route.legs || [];
            let distanceMeters = 0;
            let durationSeconds = 0;

            for (const leg of legs) {
                distanceMeters += leg.distance?.value || 0;
                durationSeconds += leg.duration?.value || 0;
            }

            return {
                polyline: route.overview_polyline?.points || '',
                distanceMeters: distanceMeters > 0 ? distanceMeters : null,
                durationSeconds: durationSeconds > 0 ? durationSeconds : null,
                distanceKm:
                    distanceMeters > 0 ? Number((distanceMeters / 1000).toFixed(2)) : null,
            };
        }

        logger.warn(`Google Directions API returned status: ${data.status}. Message: ${data.error_message || 'No routes found'}`);
    } catch (err) {
        logger.error(`Error fetching driving route from Google: ${err.message}`);
    }

    return empty;
}

/**
 * Fetches an encoded polyline from Google Directions API.
 * This should be called ONLY ONCE per order assignment to save costs.
 * @param {Object} origin - { lat, lng }
 * @param {Object} destination - { lat, lng }
 * @returns {Promise<string>} - Encoded polyline points
 */
export async function fetchPolyline(origin, destination) {
    const { polyline } = await fetchDrivingRoute(origin, destination);
    return polyline;
}
