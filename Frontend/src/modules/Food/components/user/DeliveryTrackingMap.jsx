import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleMap,
  OverlayView,
  Polyline,
  useJsApiLoader,
} from '@react-google-maps/api';
import bikeLogo from '@food/assets/bikelogo.png';
import { subscribeOrderTracking } from '@food/realtimeTracking';
import { Navigation } from 'lucide-react';
import { MAPS_SCRIPT_ID } from '@food/utils/googleMapsLoader';
import { buildVisibleRouteFromRiderPosition, decodePolyline } from '@food/utils/liveTrackingPolyline';

const LOCATION_UPDATE_INTERVAL_MS = 60 * 1000;

const MAP_LIBRARIES = [];

const MUTED_MAP_STYLES = [
  { featureType: 'all', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'all', elementType: 'labels.text.stroke', stylers: [{ color: '#f8fafc' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
];

const RESTAURANT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const CUSTOMER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLatLng(source = {}) {
  const nested = source?.location && typeof source.location === 'object'
    ? source.location
    : source;

  const lat = toFiniteNumber(
    nested?.lat ??
    nested?.latitude ??
    nested?.boy_lat ??
    nested?.coords?.latitude ??
    (Array.isArray(nested?.coordinates) ? nested.coordinates[1] : null),
  );
  const lng = toFiniteNumber(
    nested?.lng ??
    nested?.longitude ??
    nested?.boy_lng ??
    nested?.coords?.longitude ??
    (Array.isArray(nested?.coordinates) ? nested.coordinates[0] : null),
  );

  if (lat === null || lng === null) return null;

  return {
    lat,
    lng,
    heading: toFiniteNumber(nested?.heading ?? nested?.bearing) ?? 0,
    eta: nested?.eta ?? source?.eta ?? null,
    polyline: nested?.polyline ?? source?.polyline ?? null,
    routeCoordinates: nested?.route_coordinates ?? source?.route_coordinates ?? null,
  };
}

function normalizePolyline(value) {
  if (!value) return [];

  if (typeof value === 'string') {
    return decodePolyline(value);
  }

  if (typeof value?.points === 'string') {
    return decodePolyline(value.points);
  }

  if (Array.isArray(value)) {
    return value
      .map((point) => {
        if (Array.isArray(point) && point.length >= 2) {
          return { lat: toFiniteNumber(point[0]), lng: toFiniteNumber(point[1]) };
        }
        return {
          lat: toFiniteNumber(point?.lat ?? point?.latitude),
          lng: toFiniteNumber(point?.lng ?? point?.longitude),
        };
      })
      .filter((point) => point.lat !== null && point.lng !== null);
  }

  return [];
}

function getInitialRiderLocation(order) {
  return normalizeLatLng(order?.deliveryState?.currentLocation || order?.lastRiderLocation || null);
}

function fitStaticBounds(map, google, restaurantCoords, customerCoords, riderLocation) {
  if (!map || !google || !restaurantCoords || !customerCoords) return;

  const bounds = new google.maps.LatLngBounds();
  bounds.extend(restaurantCoords);
  bounds.extend(customerCoords);
  if (riderLocation) bounds.extend(riderLocation);

  map.fitBounds(bounds, {
    top: 90,
    bottom: 110,
    left: 55,
    right: 55,
  });
}

const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  order = null,
  onEtaUpdate = null,
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(() => getInitialRiderLocation(order));
  const [currentEta, setCurrentEta] = useState(null);
  const [routePolyline, setRoutePolyline] = useState([]);
  const pendingTrackingRef = useRef(null);
  const lastAppliedAtRef = useRef(0);
  const hasFitBoundsRef = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
    id: MAPS_SCRIPT_ID,
  });

  const trackingIds = useMemo(() => {
    const ids = [orderId, ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, orderTrackingIds]);

  const tripStatus = String(order?.status || order?.orderStatus || 'pending').toLowerCase();
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'delivered'].includes(tripStatus);

  const center = useMemo(() => {
    if (isOrderPickedUp) return customerCoords || restaurantCoords || { lat: 0, lng: 0 };
    return restaurantCoords || customerCoords || { lat: 0, lng: 0 };
  }, [customerCoords, isOrderPickedUp, restaurantCoords]);

  const baselinePath = useMemo(() => {
    if (!restaurantCoords || !customerCoords) return [];
    return [restaurantCoords, customerCoords];
  }, [customerCoords, restaurantCoords]);

  const fallbackActivePath = useMemo(() => {
    if (!riderLocation) return [];
    const destination = isOrderPickedUp ? customerCoords : restaurantCoords;
    if (!destination) return [];
    return [riderLocation, destination];
  }, [customerCoords, isOrderPickedUp, restaurantCoords, riderLocation]);

  const visibleRoutePath = useMemo(() => {
    if (routePolyline.length >= 2) {
      return buildVisibleRouteFromRiderPosition(routePolyline, riderLocation, {
        offRouteThresholdMeters: 120,
      }).visiblePolyline;
    }
    return fallbackActivePath;
  }, [fallbackActivePath, riderLocation, routePolyline]);

  const applyTrackingData = useCallback((data, { force = false } = {}) => {
    const location = normalizeLatLng(data);
    if (!location) return;

    const now = Date.now();
    const canApplyNow = force || !lastAppliedAtRef.current || now - lastAppliedAtRef.current >= LOCATION_UPDATE_INTERVAL_MS;

    if (!canApplyNow) {
      pendingTrackingRef.current = location;
      return;
    }

    pendingTrackingRef.current = null;
    lastAppliedAtRef.current = now;
    setRiderLocation(location);

    const nextPolyline = normalizePolyline(location.polyline || location.routeCoordinates);
    if (nextPolyline.length >= 2) {
      setRoutePolyline(nextPolyline);
    }

    if (location.eta) {
      setCurrentEta(location.eta);
      onEtaUpdate?.(location.eta);
    }
  }, [onEtaUpdate]);

  useEffect(() => {
    const initial = getInitialRiderLocation(order);
    if (initial && !riderLocation) {
      setRiderLocation(initial);
    }
  }, [order, riderLocation]);

  useEffect(() => {
    if (!trackingIds.length) return undefined;

    const unsubscribers = trackingIds.map((id) =>
      subscribeOrderTracking(id, (data) => {
        applyTrackingData(data, { force: !lastAppliedAtRef.current });
      }),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [applyTrackingData, trackingIds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (pendingTrackingRef.current) {
        applyTrackingData(pendingTrackingRef.current, { force: true });
      }
    }, LOCATION_UPDATE_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [applyTrackingData]);

  useEffect(() => {
    if (!map || !isLoaded || hasFitBoundsRef.current) return;
    fitStaticBounds(map, window.google, restaurantCoords, customerCoords, riderLocation);
    hasFitBoundsRef.current = true;
  }, [customerCoords, isLoaded, map, restaurantCoords, riderLocation]);

  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [customerCoords?.lat, customerCoords?.lng, restaurantCoords?.lat, restaurantCoords?.lng]);

  if (loadError) {
    return <div className="w-full h-full bg-gray-100" />;
  }

  if (!isLoaded) {
    return <div className="w-full h-full bg-gray-100 animate-pulse" />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl shadow-inner border border-gray-100">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        onLoad={setMap}
        options={{
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          scaleControl: false,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'cooperative',
          clickableIcons: false,
          styles: MUTED_MAP_STYLES,
        }}
      >
        {baselinePath.length >= 2 && (
          <Polyline
            path={baselinePath}
            options={{
              strokeColor: '#94a3b8',
              strokeOpacity: 0,
              strokeWeight: 4,
              zIndex: 5,
              icons: [{
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 0.45,
                  scale: 3,
                  strokeWeight: 4,
                  strokeColor: '#64748b',
                },
                offset: '0',
                repeat: '16px',
              }],
            }}
          />
        )}

        {visibleRoutePath.length >= 2 && (
          <Polyline
            path={visibleRoutePath}
            options={{
              strokeColor: isOrderPickedUp ? '#2563eb' : '#16a34a',
              strokeOpacity: 0.9,
              strokeWeight: 5,
              zIndex: 10,
            }}
          />
        )}

        {restaurantCoords && (
          <OverlayView position={restaurantCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative -translate-x-1/2 -translate-y-full mb-1">
              {!isOrderPickedUp && (
                <div className="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-orange-500/40 animate-ping" />
              )}
              <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-orange-500 overflow-hidden">
                <img
                  src={order?.restaurantLogo || order?.restaurantId?.logo || order?.restaurantId?.profileImage || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`}
                  alt="Restaurant"
                  className="w-full h-full object-contain rounded-full bg-gray-50"
                  onError={(e) => { e.currentTarget.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`; }}
                />
              </div>
              <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-orange-500 rotate-180 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
            </div>
          </OverlayView>
        )}

        {customerCoords && (
          <OverlayView position={customerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative -translate-x-1/2 -translate-y-full mb-1">
              {isOrderPickedUp && (
                <div className="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-green-500/40 animate-ping" />
              )}
              <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-green-500 overflow-hidden">
                <img
                  src={order?.customerImage || order?.userId?.profileImage || order?.userId?.avatar || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`}
                  alt="Me"
                  className="w-full h-full object-contain rounded-full bg-gray-50"
                  onError={(e) => { e.currentTarget.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`; }}
                />
              </div>
              <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-green-500 rotate-180 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
            </div>
          </OverlayView>
        )}

        {riderLocation && (
          <OverlayView position={riderLocation} mapPaneName={OverlayView.MARKER_LAYER}>
            <div
              style={{
                transform: `translate(-50%, -50%) rotate(${riderLocation.heading || 0}deg)`,
                transition: 'transform 450ms ease, left 450ms ease, top 450ms ease',
              }}
              className="relative w-16 h-16"
            >
              <img
                src="/MapRider.png"
                alt="Rider"
                className="w-full h-full object-contain drop-shadow-2xl"
                onError={(e) => { e.currentTarget.src = bikeLogo; }}
              />
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {riderLocation && currentEta && (
        <div className="absolute top-4 left-4 z-[150] pointer-events-none">
          <div className="bg-orange-500/95 backdrop-blur-xl rounded-2xl p-3 shadow-[0_10px_30px_rgba(249,115,22,0.4)] border border-orange-400/50 flex flex-col min-w-[90px] overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
            <div className="flex flex-col z-10">
              <span className="text-[9px] text-white/80 font-black uppercase tracking-[0.2em] mb-0.5">Arrival</span>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-white leading-none tracking-tighter">
                  {currentEta}
                </span>
                <div className="flex items-center gap-1.5 opacity-80">
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  <Navigation className="w-3 h-3 text-white rotate-45" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeliveryTrackingMap;
