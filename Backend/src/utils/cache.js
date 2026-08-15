/**
 * Zero-dependency in-process TTL cache with single-flight de-duplication.
 *
 * Why this exists:
 * Public endpoints (business settings, feature flags, fee settings, zone lookups)
 * are hit on every page load by every client. Without caching, a few thousand
 * users translate directly into a few thousand identical Mongo round-trips per
 * minute. This module collapses those into one query per TTL window.
 *
 * Notes for cluster mode (PM2 `instances: 'max'`):
 * The cache is per-process, so an admin write propagates to other workers only
 * after their TTL expires. TTLs here are deliberately short (seconds), and the
 * writing worker invalidates its own entry immediately, so the worst case is a
 * brief window where a stale value is served - acceptable for settings data.
 * Never cache per-user or per-order data with this.
 */

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 500;

/**
 * @param {{ ttlMs?: number, maxEntries?: number, name?: string }} [options]
 */
export function createTtlCache(options = {}) {
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const maxEntries =
    Number(options.maxEntries) > 0 ? Number(options.maxEntries) : DEFAULT_MAX_ENTRIES;

  /** @type {Map<string, { value: any, expiresAt: number }>} */
  const store = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inFlight = new Map();

  const evictIfNeeded = () => {
    // Map preserves insertion order, so the first key is the oldest write.
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  };

  /**
   * Read through the cache. Concurrent misses for the same key share a single
   * loader call, so a traffic spike cannot stampede the database.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} loader
   * @param {{ ttlMs?: number }} [callOptions]
   * @returns {Promise<T>}
   */
  const get = (key, loader, callOptions = {}) => {
    const cacheKey = String(key);
    const now = Date.now();
    const entry = store.get(cacheKey);

    if (entry && entry.expiresAt > now) {
      return Promise.resolve(entry.value);
    }

    const existing = inFlight.get(cacheKey);
    if (existing) return existing;

    const entryTtl = Number(callOptions.ttlMs) > 0 ? Number(callOptions.ttlMs) : ttlMs;

    const promise = (async () => {
      try {
        const value = await loader();
        store.delete(cacheKey); // re-insert so eviction order stays LRU-by-write
        store.set(cacheKey, { value, expiresAt: Date.now() + entryTtl });
        evictIfNeeded();
        return value;
      } catch (error) {
        // Resilience: if the loader fails but we hold a stale value, serve it
        // rather than propagating a 500 for what is usually static config data.
        if (entry) return entry.value;
        throw error;
      } finally {
        inFlight.delete(cacheKey);
      }
    })();

    inFlight.set(cacheKey, promise);
    return promise;
  };

  /** Read the cached value without triggering a load. Returns undefined on miss. */
  const peek = (key) => {
    const entry = store.get(String(key));
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.value;
  };

  /** Write a value directly (e.g. right after an admin update). */
  const set = (key, value, callOptions = {}) => {
    const entryTtl = Number(callOptions.ttlMs) > 0 ? Number(callOptions.ttlMs) : ttlMs;
    const cacheKey = String(key);
    store.delete(cacheKey);
    store.set(cacheKey, { value, expiresAt: Date.now() + entryTtl });
    evictIfNeeded();
    return value;
  };

  const del = (key) => {
    store.delete(String(key));
    inFlight.delete(String(key));
  };

  const clear = () => {
    store.clear();
    inFlight.clear();
  };

  return { get, peek, set, delete: del, clear, get size() { return store.size; } };
}

/**
 * Run an idempotent async task at most once per process, memoizing the result.
 * A failed attempt is not memoized, so the next caller retries.
 *
 * Used for one-time bootstrap work (seeding default rows) that was previously
 * re-executed on every single request.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {() => Promise<T>}
 */
export function once(fn) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = Promise.resolve()
        .then(fn)
        .catch((error) => {
          promise = null; // allow retry on next call
          throw error;
        });
    }
    return promise;
  };
}
