import { useState, useEffect, useCallback, useRef } from 'react'
import { zoneAPI } from '@food/api'
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// ---- Cross-hook caching & in-flight de-dupe (module-level) ----
// Multiple screens/components call useZone(location). Without shared caching,
// we spam /food/zones/detect with the same coords.
const ZONE_CACHE_TTL_MS = 5 * 60 * 1000
const ZONE_CACHE_MAX_ENTRIES = 100
const zoneCache = new Map() // key -> { ts, payload }
const zoneInFlight = new Map() // key -> Promise<payload>

const roundCoord = (v, digits = 5) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const p = 10 ** digits
  return Math.round(n * p) / p
}

// Zones are neighbourhood-sized areas, so bucketing coordinates to ~110m is
// plenty of precision to identify one. The previous 5-decimal key (~1m) meant
// ordinary GPS jitter produced a new key on nearly every reading, so the cache
// almost never hit and each device re-queried /zones/detect continuously.
const zoneKeyFromCoords = (lat, lng) => {
  const rLat = roundCoord(lat, 3)
  const rLng = roundCoord(lng, 3)
  if (rLat === null || rLng === null) return null
  return `${rLat},${rLng}`
}

// Map preserves insertion order, so the oldest write is the first key.
const setZoneCache = (key, payload) => {
  zoneCache.set(key, { ts: Date.now(), payload })
  while (zoneCache.size > ZONE_CACHE_MAX_ENTRIES) {
    const oldest = zoneCache.keys().next().value
    if (oldest === undefined) break
    zoneCache.delete(oldest)
  }
}

// Ray-casting point-in-polygon, mirroring the server's zone test.
const isPointInZone = (lat, lng, polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]?.longitude
    const yi = polygon[i]?.latitude
    const xj = polygon[j]?.longitude
    const yj = polygon[j]?.latitude
    if (![xi, yi, xj, yj].every(Number.isFinite)) return false
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Read the last known zone (with its polygon) so a fresh mount can answer
// "am I still in my zone?" without a round-trip.
const readStoredZone = () => {
  try {
    const raw = localStorage.getItem('userZone')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed._id ? parsed : null
  } catch {
    return null
  }
}

const applyZonePayload = (data, { setZoneId, setZone, setZoneStatus, currentZoneRef }) => {
  if (data?.status === 'IN_SERVICE' && data.zoneId) {
    setZoneId(data.zoneId)
    setZone(data.zone || null)
    setZoneStatus('IN_SERVICE')
    if (currentZoneRef) currentZoneRef.current = data.zone || null
    localStorage.setItem('userZoneId', data.zoneId)
    localStorage.setItem('userZone', JSON.stringify(data.zone))
  } else {
    setZoneId(null)
    setZone(null)
    setZoneStatus('OUT_OF_SERVICE')
    if (currentZoneRef) currentZoneRef.current = null
    localStorage.removeItem('userZoneId')
    localStorage.removeItem('userZone')
  }
}


/**
 * Hook to detect and manage user's zone based on location
 * Automatically detects zone when location is available
 */
export function useZone(location) {
  const [zoneId, setZoneId] = useState(null)
  const [zoneStatus, setZoneStatus] = useState('loading') // 'loading' | 'IN_SERVICE' | 'OUT_OF_SERVICE'
  const [zone, setZone] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const prevCoordsRef = useRef({ latitude: null, longitude: null })
  const debounceTimerRef = useRef(null)
  // Last known zone including its polygon, used to short-circuit re-detection.
  const currentZoneRef = useRef(readStoredZone())

  // Detect zone when location is available
  const detectZone = useCallback(async (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setZoneStatus("OUT_OF_SERVICE");
      setZoneId(null);
      setZone(null);
      return;
    }

    try {
      setLoading(true)
      setError(null)

      const key = zoneKeyFromCoords(lat, lng)
      const now = Date.now()
      if (key) {
        const cached = zoneCache.get(key)
        if (cached && now - cached.ts < ZONE_CACHE_TTL_MS) {
          applyZonePayload(cached.payload, { setZoneId, setZone, setZoneStatus, currentZoneRef })
          return
        }
      }

      // If we already know which zone the user is in and they are still inside
      // its polygon, the answer cannot have changed - skip the request entirely.
      // This is what keeps a moving user (or GPS jitter) from re-hitting
      // /zones/detect every few seconds.
      const knownZone = currentZoneRef.current
      if (knownZone?._id && isPointInZone(lat, lng, knownZone.coordinates)) {
        const payload = { status: 'IN_SERVICE', zoneId: knownZone._id, zone: knownZone }
        if (key) setZoneCache(key, payload)
        applyZonePayload(payload, { setZoneId, setZone, setZoneStatus, currentZoneRef })
        return
      }

      const promise = (() => {
        if (key && zoneInFlight.has(key)) return zoneInFlight.get(key)
        const p = zoneAPI
          .detectZone(lat, lng)
          .then((response) => {
            if (!response?.data?.success) {
              throw new Error(response?.data?.message || 'Failed to detect zone')
            }
            return response.data.data
          })
          .finally(() => {
            if (key) zoneInFlight.delete(key)
          })
        if (key) zoneInFlight.set(key, p)
        return p
      })()

      const data = await promise
      if (key) setZoneCache(key, data)
      applyZonePayload(data, { setZoneId, setZone, setZoneStatus, currentZoneRef })
    } catch (err) {
      debugError("Error detecting zone:", err);
      setError(
        err.response?.data?.message || err.message || "Failed to detect zone",
      );

      // Try to use cached zone if available
      const cachedZoneId = localStorage.getItem("userZoneId");
      if (cachedZoneId) {
        const cachedZone = localStorage.getItem("userZone");
        setZoneId(cachedZoneId);
        setZone(cachedZone ? JSON.parse(cachedZone) : null);
        setZoneStatus("IN_SERVICE");
      } else {
        // If everything fails, mark as OUT_OF_SERVICE to stop loading skeletons
        setZoneStatus("OUT_OF_SERVICE");
        setZoneId(null);
        setZone(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-detect zone when location changes
  useEffect(() => {
    const lat = roundCoord(location?.latitude, 6)
    const lng = roundCoord(location?.longitude, 6)

    // Check if coordinates have changed significantly (threshold: ~10 meters)
    const coordThreshold = 0.0001; // approximately 10 meters
    const coordsChanged =
      !prevCoordsRef.current.latitude ||
      !prevCoordsRef.current.longitude ||
      Math.abs(prevCoordsRef.current.latitude - (lat || 0)) > coordThreshold ||
      Math.abs(prevCoordsRef.current.longitude - (lng || 0)) > coordThreshold;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Only detect zone if coordinates changed significantly
      if (coordsChanged) {
        prevCoordsRef.current = { latitude: lat, longitude: lng }
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
          detectZone(lat, lng)
        }, 350)
      }
    } else {
      // Try to use cached zone if location not available
      const cachedZoneId = localStorage.getItem("userZoneId");
      if (cachedZoneId) {
        const cachedZone = localStorage.getItem("userZone");
        setZoneId(cachedZoneId);
        setZone(cachedZone ? JSON.parse(cachedZone) : null);
        setZoneStatus("IN_SERVICE");
      } else {
        setZoneStatus("OUT_OF_SERVICE");
        setZoneId(null);
        setZone(null);
      }
    }
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [location?.latitude, location?.longitude, detectZone])

  // Manual refresh zone
  const refreshZone = useCallback(() => {
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      detectZone(lat, lng);
    }
  }, [location?.latitude, location?.longitude, detectZone]);

  return {
    zoneId,
    zone,
    zoneStatus,
    loading,
    error,
    isInService: zoneStatus === "IN_SERVICE",
    isOutOfService: zoneStatus === "OUT_OF_SERVICE",
    refreshZone,
  };
}
