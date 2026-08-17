import { loadGoogleMaps } from "@food/utils/googleMapsLoader";

export function formatDistanceLabel(km) {
  if (km == null || !Number.isFinite(Number(km))) return "--";
  const value = Number(km);
  if (value >= 1) return `${value.toFixed(1)} KM`;
  return `${Math.round(value * 1000)} M`;
}

function toPoint(entity) {
  if (!entity || typeof entity !== "object") return null;

  const queue = [entity];
  const visited = new Set();
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source || typeof source !== "object" || visited.has(source)) continue;
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

    if (source.location && typeof source.location === "object") {
      queue.push(source.location);
    }
  }

  return null;
}

/**
 * Delegates to the shared loader rather than injecting its own script tag.
 * This util only needs Directions, but the shared loader requests one superset
 * of libraries for the whole app so no component can trigger a reload.
 */
async function ensureGoogleMapsLoaded() {
  if (typeof window === "undefined") return false;
  if (window.google?.maps?.DirectionsService) return true;
  const google = await loadGoogleMaps();
  return Boolean(google?.maps?.DirectionsService);
}

/**
 * Road distance for a fixed pair of points never changes, so cache it.
 *
 * Keyed on both points rounded to ~11 m. In-flight requests are shared, so N
 * components asking for the same pair at the same moment produce ONE billed
 * Directions request rather than N.
 */
const distanceCache = new Map();
const distanceInFlight = new Map();
const DISTANCE_CACHE_MAX = 500;

const distanceKey = (origin, destination) =>
  `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}|${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;

export async function fetchDrivingDistanceKm(originEntity, destinationEntity) {
  const origin = toPoint(originEntity);
  const destination = toPoint(destinationEntity);
  if (!origin || !destination) return null;

  const key = distanceKey(origin, destination);
  if (distanceCache.has(key)) return distanceCache.get(key);
  if (distanceInFlight.has(key)) return distanceInFlight.get(key);

  const request = requestDrivingDistanceKm(origin, destination)
    .then((value) => {
      // Only cache real answers; a null must stay retryable.
      if (value != null) {
        if (distanceCache.size >= DISTANCE_CACHE_MAX) {
          distanceCache.delete(distanceCache.keys().next().value);
        }
        distanceCache.set(key, value);
      }
      return value;
    })
    .finally(() => {
      distanceInFlight.delete(key);
    });

  distanceInFlight.set(key, request);
  return request;
}

async function requestDrivingDistanceKm(origin, destination) {
  const loaded = await ensureGoogleMapsLoaded();
  if (!loaded || !window.google?.maps?.DirectionsService) return null;

  return new Promise((resolve) => {
    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== "OK" || !result?.routes?.[0]?.legs?.length) {
          resolve(null);
          return;
        }

        let meters = 0;
        for (const leg of result.routes[0].legs) {
          meters += leg.distance?.value || 0;
        }

        if (meters <= 0) {
          resolve(null);
          return;
        }

        resolve(Number((meters / 1000).toFixed(2)));
      },
    );
  });
}

export async function fetchDrivingDistancesMatrix(originEntity, destinationEntities = []) {
  const origin = toPoint(originEntity);
  if (!origin || !Array.isArray(destinationEntities) || destinationEntities.length === 0) {
    return [];
  }

  const loaded = await ensureGoogleMapsLoaded();
  if (!loaded) {
    return destinationEntities.map(() => null);
  }

  const output = new Array(destinationEntities.length).fill(null);
  const concurrency = 4;

  for (let start = 0; start < destinationEntities.length; start += concurrency) {
    const batch = destinationEntities.slice(start, start + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(
      batch.map((destination) => fetchDrivingDistanceKm(origin, destination)),
    );

    batchResults.forEach((km, index) => {
      output[start + index] = Number.isFinite(Number(km)) ? Number(km) : null;
    });
  }

  return output;
}
