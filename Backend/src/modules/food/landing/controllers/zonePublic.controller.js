import { FoodZone } from '../../admin/models/zone.model.js';
import { createTtlCache } from '../../../../utils/cache.js';

const toFinite = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
};

/**
 * Zones are admin-managed and change rarely, but `/zones/detect` is called by
 * every client on load and again whenever the device reports movement. Loading
 * every zone polygon from Mongo per request was the bulk of that endpoint's
 * latency, so the zone set is cached and pre-processed once per TTL.
 */
const ZONES_CACHE_TTL_MS = 60_000;
const zonesCache = createTtlCache({ ttlMs: ZONES_CACHE_TTL_MS, maxEntries: 2, name: 'zones' });
const zoneListCache = createTtlCache({ ttlMs: ZONES_CACHE_TTL_MS, maxEntries: 2, name: 'zone-list' });
const ACTIVE_ZONES_KEY = 'active';

/** Drop the cached zone data after an admin creates/edits/deletes a zone. */
export function invalidateZonesCache() {
    zonesCache.clear();
    zoneListCache.clear();
}

/**
 * Precompute an axis-aligned bounding box per zone. Testing a point against a
 * bounding box is a handful of comparisons, versus a full ray-cast over every
 * vertex; only zones whose box contains the point need the exact test.
 */
const buildZoneIndex = (zones) =>
    zones
        .map((zone) => {
            const coords = Array.isArray(zone.coordinates) ? zone.coordinates : [];
            if (coords.length < 3) return null;

            let minLat = Infinity;
            let maxLat = -Infinity;
            let minLng = Infinity;
            let maxLng = -Infinity;

            for (const point of coords) {
                const lat = Number(point?.latitude);
                const lng = Number(point?.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }

            return { zone, coords, minLat, maxLat, minLng, maxLng };
        })
        .filter(Boolean);

const loadActiveZoneIndex = async () => {
    const zones = await FoodZone.find({ isActive: true }).lean();
    return buildZoneIndex(zones);
};

// Ray-casting point-in-polygon for lat/lng polygons.
const isPointInPolygon = (lat, lng, polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].longitude;
        const yi = polygon[i].latitude;
        const xj = polygon[j].longitude;
        const yj = polygon[j].latitude;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

/** GET /zones/detect?lat=..&lng=.. */
export const detectZonePublicController = async (req, res, next) => {
    try {
        const lat = toFinite(req.query.lat);
        const lng = toFinite(req.query.lng);
        if (lat === null || lng === null) {
            return res.status(400).json({ success: false, message: 'lat and lng are required' });
        }

        const zoneIndex = await zonesCache.get(ACTIVE_ZONES_KEY, loadActiveZoneIndex);

        for (const entry of zoneIndex) {
            // Cheap rejection first; most zones will not contain the point.
            if (
                lat < entry.minLat ||
                lat > entry.maxLat ||
                lng < entry.minLng ||
                lng > entry.maxLng
            ) {
                continue;
            }
            if (isPointInPolygon(lat, lng, entry.coords)) {
                return res.status(200).json({
                    success: true,
                    message: 'Zone detected',
                    data: { status: 'IN_SERVICE', zoneId: entry.zone._id, zone: entry.zone }
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Out of service',
            data: { status: 'OUT_OF_SERVICE', zoneId: null, zone: null }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * The public zone lists are identical queries used for onboarding selects and
 * nearby visualisation, so they share one cache entry.
 */
const ZONE_LIST_PROJECTION = 'name zoneName serviceLocation country unit isActive coordinates createdAt';

const loadPublicZoneList = () =>
    FoodZone.find({ isActive: true })
        .select(ZONE_LIST_PROJECTION)
        .sort({ createdAt: 1 })
        .lean();

/** GET /zones/public - list active zones for onboarding/selects */
export const listZonesPublicController = async (_req, res, next) => {
    try {
        const zones = await zoneListCache.get(ACTIVE_ZONES_KEY, loadPublicZoneList);

        return res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data: { zones }
        });
    } catch (error) {
        next(error);
    }
};

/** GET /zones/nearby - list zones for hotspot/nearby visualization */
export const listZonesNearbyPublicController = async (req, res, next) => {
    try {
        const zones = await zoneListCache.get(ACTIVE_ZONES_KEY, loadPublicZoneList);

        return res.status(200).json({
            success: true,
            message: 'Nearby zones fetched',
            data: { zones }
        });
    } catch (error) {
        next(error);
    }
};
