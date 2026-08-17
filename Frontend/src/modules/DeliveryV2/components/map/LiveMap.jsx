import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  GoogleMap, 
  Marker, 
  DirectionsService, 
  Polygon,
  Polyline,
  useJsApiLoader,
  OverlayView
} from '@react-google-maps/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { zoneAPI } from '@food/api';
import { MAPS_LIBRARIES, MAPS_SCRIPT_ID } from '@food/utils/googleMapsLoader';

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  inset: 0
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: false,
  fullscreenControl: false,
  styles: [
    { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
    { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] }
  ]
};
const LIBRARIES = ['places', 'geometry'];

/**
 * Fallback map centre used only before the first GPS fix arrives.
 * Exported so it is a named default rather than a magic literal in the JSX.
 */
export const DEFAULT_MAP_CENTER = { lat: 22.7196, lng: 75.8577 };

/** Rider is considered off-route beyond this distance from the drawn path. */
const OFF_ROUTE_METERS = 50;
/** Consecutive off-route fixes before forcing a reroute (debounces GPS jitter). */
const OFF_ROUTE_STRIKES = 2;

export const LiveMap = ({ onMapClick, onMapLoad, onPathReceived, onPolylineReceived, zoom = 12, followMode = true, onFollowModeChange }) => {
  const { riderLocation, activeOrder, tripStatus } = useDeliveryStore();
  
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: MAPS_LIBRARIES,
    id: MAPS_SCRIPT_ID,
  });

  useEffect(() => {
  }, []);

  useEffect(() => {
    if (isLoaded) {
      console.log('[LiveMap] Google Maps API loaded successfully.');
    }
    if (loadError) {
      console.error('[LiveMap] Google Maps API failed to load:', loadError);
    }
  }, [isLoaded, loadError]);

  const [directions, setDirections] = useState(null);
  const [map, setMapInternal] = useState(null);
  const [zones, setZones] = useState([]);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);

  const handleMapLoad = (mapInstance) => {
    mapInstance.setOptions({
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      rotateControl: false,
      fullscreenControl: false
    });
    setMapInternal(mapInstance);
    if (onMapLoad) onMapLoad(mapInstance);
  };

  useEffect(() => {
    if (!activeOrder || tripStatus === 'COMPLETED' || tripStatus === 'IDLE') {
      setLastDirectionsAt(0);
      setDirections(null);
    }
  }, [tripStatus, activeOrder?._id, activeOrder]);

  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;
    let rawLoc = null;
    if (tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') {
      rawLoc = activeOrder.restaurantLocation;
    } else if (tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') {
      rawLoc = activeOrder.customerLocation;
    }
    if (!rawLoc) return null;
    const lat = parseFloat(rawLoc.lat || rawLoc.latitude);
    const lng = parseFloat(rawLoc.lng || rawLoc.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }, [activeOrder, tripStatus]);

  const parsedRiderLocation = useMemo(() => {
    if (!riderLocation) return null;
    const lat = parseFloat(riderLocation.lat || riderLocation.latitude);
    const lng = parseFloat(riderLocation.lng || riderLocation.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng, heading: parseFloat(riderLocation.heading || 0) } : null;
  }, [riderLocation]);

  // Seed the initial view exactly once. Recomputing this would re-mount the map's
  // options and yank the rider's view back to the first GPS fix.
  const initialMapOptions = useRef(null);
  if (!initialMapOptions.current) {
    initialMapOptions.current = {
      ...mapOptions,
      center: parsedRiderLocation || DEFAULT_MAP_CENTER,
      zoom,
    };
  }

  // Single source of truth for zoom: the `zoom` prop drives setZoom, and the map
  // is never handed a competing `zoom` prop.
  useEffect(() => { if (map) map.setZoom(zoom); }, [zoom, map]);

  // OFF-ROUTE DETECTION
  //
  // Rerouting used to be purely a wall-clock throttle, so a rider who turned off
  // the route right after a refresh followed a dead line for up to a minute. If
  // the rider sits more than OFF_ROUTE_METERS from the drawn path for two
  // consecutive fixes, force a refresh regardless of the throttle. Two strikes
  // debounces ordinary GPS jitter.
  const offRouteStrikesRef = useRef(0);
  const [forceRerouteAt, setForceRerouteAt] = useState(0);

  useEffect(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps?.geometry?.poly) {
      offRouteStrikesRef.current = 0;
      return;
    }
    try {
      const path = directions.routes[0]?.overview_path;
      if (!path?.length) return;
      const here = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);
      const line = new window.google.maps.Polyline({ path });
      // isLocationOnEdge tolerance is in degrees; convert metres at the equator.
      const tolerance = OFF_ROUTE_METERS / 111320;
      const onRoute = window.google.maps.geometry.poly.isLocationOnEdge(here, line, tolerance);

      if (onRoute) {
        offRouteStrikesRef.current = 0;
        return;
      }
      offRouteStrikesRef.current += 1;
      if (offRouteStrikesRef.current >= OFF_ROUTE_STRIKES) {
        offRouteStrikesRef.current = 0;
        setForceRerouteAt(Date.now());
      }
    } catch (_) {
      // Geometry failures must never break the map.
    }
  }, [directions, parsedRiderLocation]);

  const shouldUpdateRoute = useMemo(() => {
    const now = Date.now();
    if (!directions) return true;
    // A confirmed deviation bypasses the throttle entirely.
    if (forceRerouteAt > lastDirectionsAt) return true;
    let throttleMs = 20000;
    if (parsedRiderLocation && targetLocation && window.google) {
      try {
        const p1 = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);
        const p2 = new window.google.maps.LatLng(targetLocation.lat, targetLocation.lng);
        const dist = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
        if (dist > 2000) throttleMs = 60000;
        else if (dist > 500) throttleMs = 20000;
        else throttleMs = 5000;
      } catch (e) {}
    }
    return (now - lastDirectionsAt) >= throttleMs;
  }, [lastDirectionsAt, directions, parsedRiderLocation, targetLocation, forceRerouteAt]);

  useEffect(() => {
    if (directions && onPathReceived) {
      const path = directions.routes[0]?.overview_path;
      if (path) {
        const simplePath = path.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : (p.lat || p.latitude),
          lng: typeof p.lng === 'function' ? p.lng() : (p.lng || p.longitude)
        }));
        onPathReceived(simplePath);
      }
    }
  }, [directions, onPathReceived]);

  // Directions requests outlive the component if the rider navigates away
  // mid-flight. Without this guard the callback calls setState on an unmounted
  // component (React warning, and a wasted billed request either way).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const directionsCallback = useCallback((result, status) => {
    if (!mountedRef.current) return;
    if (status === 'OK' && result) {
      setDirections(result);
      setLastDirectionsAt(Date.now());
      const encodedPolyline = result.routes[0]?.overview_polyline;
      if (encodedPolyline && onPolylineReceived) onPolylineReceived(encodedPolyline);
    }
  }, [onPolylineReceived]);

  useEffect(() => {
    (async () => {
      try {
        const response = await zoneAPI.getPublicZones();
        if (response?.data?.success && response.data.data?.zones) {
          const formattedZones = response.data.data.zones.map(zone => ({
            ...zone,
            paths: (zone.coordinates || []).map(coord => ({ lat: coord.latitude, lng: coord.longitude }))
          })).filter(z => z.paths.length >= 3);
          setZones(formattedZones);
        }
      } catch (err) {}
    })();
  }, []);

  const restaurantMarkerUrl = useMemo(() => {
    if (!activeOrder) return 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';
    return activeOrder.restaurantImage || activeOrder.restaurant?.logo || activeOrder.restaurant?.profileImage || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';
  }, [activeOrder]);

  const customerMarkerUrl = useMemo(() => {
    if (!activeOrder) return 'https://cdn-icons-png.flaticon.com/512/1275/1275302.png';
    return activeOrder.customerImage || activeOrder.user?.logo || activeOrder.user?.profileImage || 'https://cdn-icons-png.flaticon.com/512/1275/1275302.png';
  }, [activeOrder]);

  // FOLLOW MODE
  //
  // `center` used to be a controlled prop recomputed on every render, fighting
  // this panTo effect. The result was that dragging the map snapped straight back
  // on the next GPS tick, so a rider could never look ahead at the route or hunt
  // for a building entrance. The map is now uncontrolled (defaultCenter set once)
  // and this effect only follows while follow mode is armed. Dragging disarms it;
  // the Center-map button re-arms it.
  const lastCenteredPosRef = useRef(null);
  useEffect(() => {
    if (!map || !parsedRiderLocation || !followMode) return;

    if (!lastCenteredPosRef.current) {
      map.panTo(parsedRiderLocation);
      lastCenteredPosRef.current = parsedRiderLocation;
      return;
    }
    const dist = window.google.maps.geometry.spherical.computeDistanceBetween(
      new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng),
      new window.google.maps.LatLng(lastCenteredPosRef.current.lat, lastCenteredPosRef.current.lng)
    );
    if (dist > 30) {
      map.panTo(parsedRiderLocation);
      lastCenteredPosRef.current = parsedRiderLocation;
    }
  }, [map, parsedRiderLocation, followMode]);

  // A user-initiated drag disarms follow mode. `dragstart` only fires for real
  // gestures, not for programmatic panTo, so this cannot disarm itself.
  useEffect(() => {
    if (!map || !window.google) return;
    const listener = map.addListener('dragstart', () => onFollowModeChange?.(false));
    return () => listener?.remove?.();
  }, [map, onFollowModeChange]);

  const remainingPath = useMemo(() => {
    if (!directions || !parsedRiderLocation) return [];
    const fullPath = directions.routes[0].overview_path;
    let closestIndex = 0;
    let minDist = Infinity;
    const rPos = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);
    for (let i = 0; i < fullPath.length; i++) {
       const d = window.google.maps.geometry.spherical.computeDistanceBetween(rPos, fullPath[i]);
       if (d < minDist) { minDist = d; closestIndex = i; }
    }
    return [{ lat: parsedRiderLocation.lat, lng: parsedRiderLocation.lng }, ...fullPath.slice(closestIndex + 1)];
  }, [directions, parsedRiderLocation]);

  if (loadError) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-red-500 font-bold">Map Load Error</div>;
  if (!isLoaded) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  const directionsServiceOptions = (parsedRiderLocation && targetLocation) ? {
    origin: parsedRiderLocation,
    destination: targetLocation,
    travelMode: 'DRIVING',
  } : null;

  return (
    <div className="absolute inset-0 z-0 text-gray-900 overflow-hidden flex flex-col">
      {/*
        Deliberately UNCONTROLLED. Passing `center`/`zoom` as props makes the map
        controlled, which fought both the panTo effect and the zoom effect and
        snapped the rider's view back on every render. The initial view is seeded
        once through options; the effects own it from then on.
      */}
      <GoogleMap
        onLoad={handleMapLoad}
        mapContainerStyle={mapContainerStyle}
        options={initialMapOptions.current}
        onClick={(e) => onMapClick?.(e.latLng.lat(), e.latLng.lng())}
      >
        {directionsServiceOptions && shouldUpdateRoute && (
          <DirectionsService options={directionsServiceOptions} callback={directionsCallback} />
        )}

        {remainingPath.length > 0 && (
          <Polyline path={remainingPath} options={{ strokeColor: '#22c55e', strokeOpacity: 0.9, strokeWeight: 6, zIndex: 10 }} />
        )}

        {directions && (
          <Polyline path={directions.routes[0].overview_path} options={{ strokeColor: '#94a3b8', strokeOpacity: 0, strokeWeight: 4, zIndex: 1, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.3, scale: 3, strokeWeight: 4, strokeColor: '#64748b' }, offset: '0', repeat: '15px' }] }} />
        )}

        {parsedRiderLocation && (
          <OverlayView position={parsedRiderLocation} mapPaneName={OverlayView.MARKER_LAYER}>
            <div style={{ transform: `translate(-50%, -50%) rotate(${parsedRiderLocation.heading || 0}deg)`, transition: 'transform 0.5s linear' }} className="relative w-[72px] h-[72px]">
              <img src="/MapRider.png" alt="Rider" className="w-full h-full object-contain" />
            </div>
          </OverlayView>
        )}

        {targetLocation && (
          <Marker position={targetLocation} icon={{ url: (tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') ? restaurantMarkerUrl : customerMarkerUrl, scaledSize: new window.google.maps.Size(44, 44), anchor: new window.google.maps.Point(22, 22) }} />
        )}

        {zones.map((zone) => (
          <Polygon key={zone._id} paths={zone.paths} options={{ fillColor: "#22c55e", fillOpacity: 0.1, strokeColor: "#22c55e", strokeOpacity: 0.4, strokeWeight: 2, zIndex: 1 }} />
        ))}
      </GoogleMap>
    </div>
  );
};

export default LiveMap;
