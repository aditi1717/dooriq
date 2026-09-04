import { getCachedBusinessSettings } from '../admin/controllers/businessSettings.controller.js';

const DEFAULT_SERVING_RADIUS_KM = 7;

export const getDefaultServingRadiusKm = async () => {
    try {
        const settings = await getCachedBusinessSettings();
        const radius = Number(settings?.defaultServingRadiusKm);
        return Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_SERVING_RADIUS_KM;
    } catch {
        return DEFAULT_SERVING_RADIUS_KM;
    }
};

export const toLatLngPoint = (entity) => {
    if (!entity || typeof entity !== 'object') return null;

    const queue = [entity];
    const visited = new Set();

    while (queue.length > 0) {
        const source = queue.shift();
        if (!source || typeof source !== 'object' || visited.has(source)) continue;
        visited.add(source);

        if (Array.isArray(source.coordinates) && source.coordinates.length >= 2) {
            const [lng, lat] = source.coordinates;
            if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
                return { lat: Number(lat), lng: Number(lng) };
            }
        }

        const lat = Number(source.latitude ?? source.lat);
        const lng = Number(source.longitude ?? source.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }

        if (source.location && typeof source.location === 'object') {
            queue.push(source.location);
        }
    }

    return null;
};

export const haversineKm = (origin, destination) => {
    const start = toLatLngPoint(origin);
    const end = toLatLngPoint(destination);
    if (!start || !end) return null;

    const dLat = ((end.lat - start.lat) * Math.PI) / 180;
    const dLng = ((end.lng - start.lng) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((start.lat * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
};

/**
 * Shared public-listing visibility gate:
 * 1. compute straight-line distance
 * 2. keep restaurants inside the configured radius
 * 3. sort by straight-line distance
 */
export const filterRestaurantsByRoadRadius = async (
    restaurants = [],
    origin,
    { radiusKm } = {},
) => {
    const userPoint = toLatLngPoint(origin);
    if (!userPoint || !Array.isArray(restaurants) || restaurants.length === 0) {
        return [];
    }

    const effectiveRadiusKm =
        Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0
            ? Number(radiusKm)
            : await getDefaultServingRadiusKm();

    return restaurants
        .map((restaurant) => {
            const restaurantPoint = toLatLngPoint(restaurant?.location || restaurant);
            const straightLineDistanceKm = restaurantPoint
                ? haversineKm(userPoint, restaurantPoint)
                : null;

            return {
                restaurant,
                restaurantPoint,
                straightLineDistanceKm:
                    Number.isFinite(straightLineDistanceKm)
                        ? Number(straightLineDistanceKm.toFixed(2))
                        : null,
            };
        })
        .filter(
            ({ straightLineDistanceKm }) =>
                Number.isFinite(straightLineDistanceKm) &&
                straightLineDistanceKm <= effectiveRadiusKm,
        )
        .sort((left, right) => {
            const leftDistance = left.straightLineDistanceKm ?? Infinity;
            const rightDistance = right.straightLineDistanceKm ?? Infinity;
            return leftDistance - rightDistance;
        })
        .map((candidate) => ({
            ...candidate.restaurant,
            distanceScore: candidate.straightLineDistanceKm,
            straightLineDistanceKm: candidate.straightLineDistanceKm,
            roadDistanceKm: null,
            visibilityDistanceSource: 'straight-line',
        }));
};
