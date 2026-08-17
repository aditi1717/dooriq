/**
 * Google Maps deep links for rider navigation.
 *
 * The app previously opened `maps/search/?api=1&query=<address string>` for the
 * restaurant and as a customer fallback. Two problems with that:
 *
 *  1. `search` shows a search RESULT, it does not start navigation. The rider has
 *     to tap through before they get directions.
 *  2. Resolving a free-text address is a guess. In dense areas Google routinely
 *     lands on the wrong building — or the wrong branch of the same chain — even
 *     though the order payload already carries exact coordinates.
 *
 * `maps/dir/?api=1&destination=<lat>,<lng>&dir_action=navigate` starts turn-by-turn
 * against an exact point, and works on Android, iOS and desktop web.
 */

const isFiniteCoord = (value) => Number.isFinite(Number(value));

/**
 * Extract { lat, lng } from the many shapes an order carries locations in.
 * @returns {{lat:number,lng:number}|null}
 */
export function toLatLng(source) {
  if (!source || typeof source !== 'object') return null;

  if (Array.isArray(source.coordinates) && source.coordinates.length >= 2) {
    const [lng, lat] = source.coordinates;
    if (isFiniteCoord(lat) && isFiniteCoord(lng)) {
      return { lat: Number(lat), lng: Number(lng) };
    }
  }

  const lat = source.latitude ?? source.lat;
  const lng = source.longitude ?? source.lng;
  if (isFiniteCoord(lat) && isFiniteCoord(lng)) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  if (source.location && typeof source.location === 'object') {
    return toLatLng(source.location);
  }

  return null;
}

/**
 * Build a navigation URL. Prefers exact coordinates; falls back to an address
 * string only when there are genuinely no coordinates available — and even then
 * uses the directions endpoint rather than search.
 *
 * @param {object|null} point Anything toLatLng() understands.
 * @param {string} [fallbackAddress]
 * @returns {string|null} null when there is nothing usable to navigate to.
 */
export function buildNavigationUrl(point, fallbackAddress = '') {
  const coords = toLatLng(point);
  if (coords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}` +
      '&travelmode=driving&dir_action=navigate';
  }

  const address = String(fallbackAddress || '').trim();
  if (!address) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` +
    '&travelmode=driving&dir_action=navigate';
}

/**
 * Open navigation in a new tab/app. No-op when there is no usable destination,
 * so a missing address cannot open a blank Google Maps page.
 * @returns {boolean} whether navigation was opened
 */
export function openNavigation(point, fallbackAddress = '') {
  const url = buildNavigationUrl(point, fallbackAddress);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
