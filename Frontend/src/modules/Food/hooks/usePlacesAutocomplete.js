import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@food/utils/googleMapsLoader";

/**
 * Places Autocomplete with correct session-token billing and debouncing.
 *
 * Google bills Autocomplete per *session* when a session token accompanies the
 * prediction requests and the final Place Details call — a session being "user
 * types, then picks one result". Without a token every keystroke is billed as
 * its own request, so a 20-character address costs 20 predictions instead of 1.
 *
 * Three surfaces did this correctly and six did not. This hook exists so the
 * rule lives in one place: it owns the token lifecycle (new token per session,
 * retired the moment a place is selected) and debounces input so a fast typist
 * does not generate a request per character either.
 */

const DEBOUNCE_MS = 300;
/** Below this, predictions are noise and not worth a request. */
const MIN_QUERY_LENGTH = 3;

export function usePlacesAutocomplete(options = {}) {
  const {
    debounceMs = DEBOUNCE_MS,
    minLength = MIN_QUERY_LENGTH,
    componentRestrictions = { country: "in" },
  } = options;

  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);

  const serviceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const debounceRef = useRef(null);
  /** Guards against a slow response overwriting a newer query's results. */
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const ensureServices = useCallback(async () => {
    if (serviceRef.current && placesServiceRef.current) return true;

    const google = await loadGoogleMaps();
    if (!google?.maps?.places) return false;

    if (!serviceRef.current) {
      serviceRef.current = new google.maps.places.AutocompleteService();
    }
    if (!placesServiceRef.current) {
      // PlacesService needs a DOM node or a map; a detached div is the standard
      // way to use it without rendering a map.
      placesServiceRef.current = new google.maps.places.PlacesService(
        document.createElement("div"),
      );
    }
    if (!sessionTokenRef.current && google.maps.places.AutocompleteSessionToken) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
    return true;
  }, []);

  /** Start a fresh billing session. Called after a selection completes one. */
  const resetSession = useCallback(() => {
    const token = window.google?.maps?.places?.AutocompleteSessionToken;
    sessionTokenRef.current = token ? new window.google.maps.places.AutocompleteSessionToken() : null;
  }, []);

  const search = useCallback(
    (query) => {
      const trimmed = String(query || "").trim();

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (trimmed.length < minLength) {
        setPredictions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        const ready = await ensureServices();
        if (!ready || !mountedRef.current) {
          setLoading(false);
          return;
        }

        const seq = ++requestSeqRef.current;
        serviceRef.current.getPlacePredictions(
          {
            input: trimmed,
            componentRestrictions,
            sessionToken: sessionTokenRef.current || undefined,
          },
          (results, status) => {
            // Ignore a stale response from a superseded keystroke.
            if (!mountedRef.current || seq !== requestSeqRef.current) return;
            const ok = status === window.google?.maps?.places?.PlacesServiceStatus?.OK;
            setPredictions(ok && Array.isArray(results) ? results : []);
            setLoading(false);
          },
        );
      }, debounceMs);
    },
    [componentRestrictions, debounceMs, ensureServices, minLength],
  );

  /**
   * Resolve a prediction to full details. Passing the same session token here is
   * what closes the billing session — omitting it makes Google bill the details
   * call separately.
   *
   * @returns {Promise<{lat:number,lng:number,formattedAddress:string,components:object[]}|null>}
   */
  const selectPrediction = useCallback(
    async (placeId) => {
      if (!placeId) return null;
      const ready = await ensureServices();
      if (!ready) return null;

      return new Promise((resolve) => {
        placesServiceRef.current.getDetails(
          {
            placeId,
            fields: ["geometry", "formatted_address", "address_components", "name"],
            sessionToken: sessionTokenRef.current || undefined,
          },
          (place, status) => {
            // The session ends here whether or not it succeeded.
            resetSession();

            const ok = status === window.google?.maps?.places?.PlacesServiceStatus?.OK;
            if (!ok || !place?.geometry?.location) return resolve(null);

            resolve({
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              formattedAddress: place.formatted_address || place.name || "",
              components: place.address_components || [],
            });
          },
        );
      });
    },
    [ensureServices, resetSession],
  );

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPredictions([]);
    setLoading(false);
  }, []);

  return { predictions, loading, search, selectPrediction, clear, resetSession };
}

export default usePlacesAutocomplete;
