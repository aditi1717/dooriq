/**
 * Google Maps browser key.
 *
 * Resolution order is admin panel, then build-time env. The admin value wins so
 * the key can be rotated from Settings -> Integrations without a rebuild; the
 * env var stays as a fallback so a deployment that has never opened that screen
 * keeps working exactly as before.
 *
 * This is the *browser* key, which is a different key from the one the server
 * uses. A browser key is restricted by HTTP referrer and is visible in page
 * source whatever we do, so fetching it over the network gives away nothing.
 * The server key is restricted by IP, is never sent to a client, and would be
 * rejected by Google in a browser anyway.
 */

const CONFIG_URL = "/api/v1/food/public/maps-config";

let cachedApiKey = null;
/** Guards against N simultaneous map mounts firing N identical requests. */
let inFlight = null;

function sanitizeApiKey(value) {
  if (!value) return "";
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function envKey() {
  return sanitizeApiKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

async function fetchFromServer() {
  try {
    const res = await fetch(CONFIG_URL, { credentials: "omit" });
    if (!res.ok) return "";
    const body = await res.json();
    return sanitizeApiKey(body?.data?.browserKey ?? body?.browserKey);
  } catch {
    // Offline, or the endpoint is unavailable on an older backend. The env
    // fallback below keeps maps working rather than blanking them.
    return "";
  }
}

/**
 * @returns {Promise<string>} the key to hand to the Maps loader, or "" if none
 *   is configured anywhere
 */
export async function getGoogleMapsApiKey() {
  if (cachedApiKey !== null) return cachedApiKey;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const fromServer = await fetchFromServer();
    cachedApiKey = fromServer || envKey();
    inFlight = null;
    return cachedApiKey;
  })();

  return inFlight;
}

/**
 * The key without waiting on the network — for call sites that must decide
 * synchronously whether maps are available at all. Returns the cached value if
 * one has been fetched, otherwise the build-time env value.
 */
export function getGoogleMapsApiKeySync() {
  return cachedApiKey !== null ? cachedApiKey : envKey();
}

/** Call after changing the key in the admin panel so the next read refetches. */
export function clearGoogleMapsApiKeyCache() {
  cachedApiKey = null;
  inFlight = null;
}
