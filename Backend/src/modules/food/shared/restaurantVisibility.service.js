import { fetchDrivingRoute } from '../orders/utils/googleMaps.js';
import { getCachedBusinessSettings } from '../admin/controllers/businessSettings.controller.js';

const DEFAULT_SERVING_RADIUS_KM = 7;
const ROAD_DISTANCE_CONCURRENCY = 4;

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

const mapWithConcurrency = async (list, mapper, concurrency = ROAD_DISTANCE_CONCURRENCY) => {
    const output = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= list.length) return;
            output[index] = await mapper(list[index], index);
        }
    };

    const workers = Array.from(
        { length: Math.max(1, Math.min(concurrency, list.length)) },
        () => worker(),
    );
    await Promise.all(workers);
    return output;
};

/**
 * Shared public-listing visibility gate:
 * 1. cheap straight-line prefilter
 * 2. cached road-distance verification only for candidates inside radius
 * 3. sort by resolved visible distance
 */
export const filterRestaurantsByRoadRadius = async (
    restaurants = [],
    origin,
    { radiusKm, includeFailedRoadChecks = true } = {},
) => {
    const userPoint = toLatLngPoint(origin);
    if (!userPoint || !Array.isArray(restaurants) || restaurants.length === 0) {
        return [];
    }

    const effectiveRadiusKm =
        Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0
            ? Number(radiusKm)
            : await getDefaultServingRadiusKm();

    const candidates = restaurants
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
        );

    const resolved = await mapWithConcurrency(candidates, async (candidate) => {
        if (!candidate.restaurantPoint) {
            return { ...candidate, roadDistanceKm: null, visible: false };
        }

        const route = await fetchDrivingRoute(userPoint, candidate.restaurantPoint);
        const roadDistanceKm = Number(route?.distanceKm);
        const hasRoadDistance = Number.isFinite(roadDistanceKm) && roadDistanceKm > 0;
        const visible = hasRoadDistance
            ? roadDistanceKm <= effectiveRadiusKm
            : includeFailedRoadChecks;

        return {
            ...candidate,
            roadDistanceKm: hasRoadDistance ? roadDistanceKm : null,
            visible,
        };
    });

    return resolved
        .filter((candidate) => candidate.visible)
        .sort((left, right) => {
            const leftDistance = left.roadDistanceKm ?? left.straightLineDistanceKm ?? Infinity;
            const rightDistance = right.roadDistanceKm ?? right.straightLineDistanceKm ?? Infinity;
            return leftDistance - rightDistance;
        })
        .map((candidate) => ({
            ...candidate.restaurant,
            distanceScore: candidate.roadDistanceKm ?? candidate.straightLineDistanceKm,
            straightLineDistanceKm: candidate.straightLineDistanceKm,
            roadDistanceKm: candidate.roadDistanceKm,
            visibilityDistanceSource: candidate.roadDistanceKm != null ? 'road' : 'straight-line-fallback',
        }));
};
