/**
 * Single entry point for loading the Google Maps JavaScript SDK.
 *
 * Before this existed the app loaded the SDK three different ways — the
 * `useJsApiLoader` hook, `@googlemaps/js-api-loader`, and seven files that
 * injected a `<script>` tag by hand — each asking for a different `libraries`
 * set. Two consequences:
 *
 *  1. Every duplicate load is a billable map load, and Google logs
 *     "You have included the Google Maps JavaScript API multiple times".
 *  2. Worse, the hand-rolled loaders REMOVED any existing script whose URL did
 *     not contain their own library string. A component that had loaded with
 *     `libraries=geometry` would have its script torn out from under it by a
 *     component wanting `libraries=places`, breaking the first one at random.
 *
 * This module loads once, with one superset of libraries, and never removes an
 * existing script. Concurrent callers share a single promise.
 */

import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey";

/**
 * One superset for the whole app. Requesting a library the page does not use is
 * free; requesting a DIFFERENT set per component is what caused reloads.
 * `geometry` is needed by the rider map (off-route detection, distance),
 * `drawing` by the admin zone editor, `places` by every address input.
 */
export const MAPS_LIBRARIES = Object.freeze(["places", "geometry", "drawing"]);

/** Shared script id, also used by the `useJsApiLoader` call sites. */
export const MAPS_SCRIPT_ID = "google-maps-sdk";

const SDK_HOST = "maps.googleapis.com/maps/api/js";

let loadPromise = null;

/** True when the SDK and the libraries we depend on are usable right now. */
export function isGoogleMapsReady() {
  return Boolean(
    typeof window !== "undefined" &&
      window.google?.maps?.places?.Autocomplete &&
      window.google?.maps?.geometry,
  );
}

function findExistingScript() {
  if (typeof document === "undefined") return null;
  return Array.from(document.getElementsByTagName("script")).find((script) =>
    script.src?.includes(SDK_HOST),
  );
}

/** Poll until the SDK finishes initialising, or give up. */
function waitForSdk(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (isGoogleMapsReady()) return resolve(window.google);
      if (Date.now() - startedAt > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Load the SDK. Safe to call from anywhere, any number of times.
 * @returns {Promise<typeof window.google | null>} null when it cannot load.
 */
export function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (isGoogleMapsReady()) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) return null;

    // Surface auth failures (bad key, referrer blocked, billing off) instead of
    // letting the SDK fail silently.
    if (!window.gm_authFailure) {
      window.gm_authFailure = () => {
        console.error(
          "[GoogleMaps] Authentication failed — check the key's referrer restrictions, enabled APIs and billing.",
        );
      };
    }

    // Someone else already started a load (including @react-google-maps/api).
    // Wait for it rather than adding a second script — and NEVER remove theirs.
    const existing = findExistingScript();
    if (existing) return waitForSdk();

    const script = document.createElement("script");
    script.id = MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src =
      `https://${SDK_HOST}?key=${encodeURIComponent(apiKey)}` +
      `&libraries=${MAPS_LIBRARIES.join(",")}&v=weekly&loading=async`;

    const loaded = await new Promise((resolve) => {
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });

    if (!loaded) return null;
    return waitForSdk();
  })().then((google) => {
    // Drop the memoised promise on failure so a later call can retry.
    if (!google) loadPromise = null;
    return google;
  });

  return loadPromise;
}
