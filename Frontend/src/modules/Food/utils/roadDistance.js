import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey";

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

let mapsLoadPromise = null;

async function ensureGoogleMapsLoaded() {
  if (typeof window === "undefined") return false;
  if (window.google?.maps?.DirectionsService) return true;
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = (async () => {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) return false;

    const existing = Array.from(document.getElementsByTagName("script")).find((script) =>
      script.src?.includes("maps.googleapis.com/maps/api/js"),
    );

    if (existing) {
      if (window.google?.maps?.DirectionsService) return true;
      await new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }).catch(() => false);
      return Boolean(window.google?.maps?.DirectionsService);
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    }).catch(() => null);

    return Boolean(window.google?.maps?.DirectionsService);
  })();

  const loaded = await mapsLoadPromise;
  if (!loaded) mapsLoadPromise = null;
  return loaded;
}

export async function fetchDrivingDistanceKm(originEntity, destinationEntity) {
  const origin = toPoint(originEntity);
  const destination = toPoint(destinationEntity);
  if (!origin || !destination) return null;

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
