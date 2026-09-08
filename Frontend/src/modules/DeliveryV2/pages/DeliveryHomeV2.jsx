import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { useProximityCheck } from '@/modules/DeliveryV2/hooks/useProximityCheck';
import { useOrderManager } from '@/modules/DeliveryV2/hooks/useOrderManager';
import { useDeliveryNotifications } from '@food/hooks/useDeliveryNotifications';
import { writeDeliveryLocation, writeOrderTracking } from '@food/realtimeTracking';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import useNotificationInbox from "@food/hooks/useNotificationInbox";

// Components
import LiveMap from '@/modules/DeliveryV2/components/map/LiveMap';
import FlutterLocationBridge from '@/modules/DeliveryV2/components/FlutterLocationBridge';
import { NewOrderModal } from '@/modules/DeliveryV2/components/modals/NewOrderModal';
import { PickupActionModal } from '@/modules/DeliveryV2/components/modals/PickupActionModal';
import { DeliveryVerificationModal } from '@/modules/DeliveryV2/components/modals/DeliveryVerificationModal';
import { OrderSummaryModal } from '@/modules/DeliveryV2/components/modals/OrderSummaryModal';
import { EnableGpsModal } from '@/modules/DeliveryV2/components/modals/EnableGpsModal';
import ActionSlider from '@/modules/DeliveryV2/components/ui/ActionSlider';

// Sub Pages
import PocketV2 from '@/modules/DeliveryV2/pages/PocketV2';
import HistoryV2 from '@/modules/DeliveryV2/pages/HistoryV2';
import ProfileV2 from '@/modules/DeliveryV2/pages/ProfileV2';

// Icons
import {
  Bell, HelpCircle, AlertTriangle, MapPinOff,
  Wallet, History, User as UserIcon, LayoutGrid,
  Plus, Minus, Navigation2, Target, Play, CheckCircle2, Clock, ChevronDown, Phone,
  Contact, Package, Ambulance, Shield, ShieldCheck, Navigation
} from 'lucide-react';

import { getHaversineDistance, calculateETA, calculateHeading } from '@/modules/DeliveryV2/utils/geo';
import { openNavigation } from '@/modules/DeliveryV2/utils/navigation';
import { isProximityBypassEnabled } from '@/modules/DeliveryV2/utils/devMode';
import { useCompanyName } from "@food/hooks/useCompanyName";
import { useNavigate } from 'react-router-dom';

const getStoredDeliveryPartnerId = () => {
  if (typeof localStorage === 'undefined') return '';

  const directId =
    localStorage.getItem('deliveryPartnerId') ||
    localStorage.getItem('deliveryPartnerMongoId') ||
    localStorage.getItem('deliveryBoyId') ||
    '';
  if (directId) return directId;

  try {
    const user = JSON.parse(localStorage.getItem('delivery_user') || '{}');
    return String(user?._id || user?.id || user?.userId || user?.deliveryPartnerId || '');
  } catch (_) {
    return '';
  }
};

/**
 * How old a GPS fix may be before the heartbeat stops replaying it.
 *
 * Comfortably longer than a normal signal gap (traffic light, indoors, tunnel)
 * but well inside the backend's `staleGpsMinutes` window, so dispatch notices a
 * genuinely dead GPS before the rider silently keeps receiving offers.
 * A stationary rider is unaffected: their app still produces real fixes.
 */
const STALE_FIX_CUTOFF_MS = 5 * 60 * 1000;

const getOrderRaceKey = (order) =>
  String(order?.orderMongoId || order?._id || order?.orderId || order?.id || '');

/**
 * Canonical realtime tracking key for an order: always the Mongo _id.
 *
 * The rider app used to stream location under the human-readable order_id while
 * the backend wrote its tracking node under the Mongo _id, so a single delivery
 * produced two Firebase nodes and two socket rooms. The customer map only worked
 * because it subscribed to several candidate ids at once.
 */
const getTrackingKey = (order) =>
  String(order?.orderMongoId || order?._id || order?.orderId || '');

const isAcceptRaceLoss = (error) => {
  const status = error?.response?.status;
  const message = error?.response?.data?.message || error?.message || '';
  return (
    error?.code === 'ORDER_CLAIMED_BY_OTHER' ||
    [403, 409, 422].includes(status) ||
    /already accepted|no longer available/i.test(message)
  );
};

/** Minimal bottom-sheet popup (Restored from legacy FeedNavbar) */
function BottomPopup({ isOpen, onClose, title, children, maxHeight = "85vh" }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[600] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative w-full max-w-lg bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden"
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full flex justify-center py-3">
          <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar px-8 pb-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">{title}</h2>
            <button onClick={onClose} className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all active:scale-95">
              <AlertTriangle className="w-5 h-5" />
            </button>
          </div>
          {children}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * DeliveryHomeV2 - Premium 1:1 Match with Original App UI.
 * Featuring logical tab switching for Feed, Pocket, History, and Profile.
 */
export default function DeliveryHomeV2({ tab = 'feed' }) {
  const navigate = useNavigate();
  const { isOnline, toggleOnline, setOnline, activeOrder, tripStatus, setRiderLocation, setActiveOrder, updateTripStatus, clearActiveOrder, riderLocation } = useDeliveryStore();
  const { isWithinRange, distanceToTarget } = useProximityCheck();
  const { acceptOrder, rejectOrder, reachPickup, pickUpOrder, reachDrop, completeDelivery, resetTrip } = useOrderManager();
  const { newOrder, clearNewOrder, clearAllOffers, orderStatusUpdate, clearOrderStatusUpdate, isConnected: isSocketConnected, emitLocation } = useDeliveryNotifications();
  const companyName = useCompanyName();
  const { unreadCount: notificationUnreadCount } = useNotificationInbox("delivery", { limit: 20 });

  const [incomingOrder, setIncomingOrder] = useState(null);
  const [acceptingOrderKey, setAcceptingOrderKey] = useState(null);
  const [currentTab, setCurrentTab] = useState(tab);

  // Track URL changes (Prop changes) to update sub-page content
  useEffect(() => {
    setCurrentTab(tab);
  }, [tab]);

  // Intercept browser/hardware back button when on pocket, history, or profile tabs
  // and redirect to the home feed tab instead of traversing tab history
  useEffect(() => {
    if (currentTab === "feed") return;

    window.history.pushState(null, null, window.location.pathname);

    const handlePopState = () => {
      navigate("/food/delivery/feed", { replace: true });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [currentTab, navigate]);

  const [showVerification, setShowVerification] = useState(false);
  const [showEmergencyPopup, setShowEmergencyPopup] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [emergencyNumbers, setEmergencyNumbers] = useState({
    medicalEmergency: "",
    accidentHelpline: "",
    contactPolice: "",
    insurance: "",
  });

  const [isModalMinimized, setIsModalMinimized] = useState(false);
  const [isGpsModalOpen, setIsGpsModalOpen] = useState(false);
  const [isGpsOff, setIsGpsOff] = useState(false);
  const [gpsErrorMessage, setGpsErrorMessage] = useState('');
  const [isCheckingGps, setIsCheckingGps] = useState(false);

  const handleGpsError = useCallback((error) => {
    setIsGpsOff(true);
    let msg = 'GPS is disabled or location permission is denied.';
    if (error?.code === error?.PERMISSION_DENIED) {
      msg = 'GPS Permission Denied! Please allow location access in your phone settings.';
    } else if (error?.code === error?.POSITION_UNAVAILABLE) {
      msg = 'GPS Position Unavailable! Please turn on device location services.';
    } else if (error?.code === error?.TIMEOUT) {
      msg = 'GPS location request timed out. Retrying...';
    }
    setGpsErrorMessage(msg);
    if (error?.code === error?.PERMISSION_DENIED || error?.code === error?.POSITION_UNAVAILABLE) {
      setIsGpsModalOpen(true);
    }
  }, []);

  const requestGpsPosition = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('GPS is not supported on this device.');
      return;
    }
    setIsCheckingGps(true);

    try {
      if (window.flutter_inappwebview?.callHandler) {
        window.flutter_inappwebview.callHandler('requestLocationPermission').catch(() => {});
      }
    } catch (_) {}

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsCheckingGps(false);
        setIsGpsOff(false);
        setGpsErrorMessage('');
        setIsGpsModalOpen(false);
        toast.success('GPS Location Enabled!');
        if (pos?.coords) {
          setRiderLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading || 0
          });
        }
      },
      (err) => {
        setIsCheckingGps(false);
        handleGpsError(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    );
  }, [handleGpsError, setRiderLocation]);
  const [eta, setEta] = useState(null);
  const lastLocationSentAt = useRef(0);
  const lastCoordRef = useRef(null);
  const lastHeadingRef = useRef(null);
  /** When the last REAL GPS fix was measured (not when we last transmitted). */
  const lastFixAtRef = useRef(0);
  const deliveryPartnerIdRef = useRef(getStoredDeliveryPartnerId());
  const rollingSpeedRef = useRef([]);
  const lastAutoArrivalRef = useRef({ PICKING_UP: false, PICKED_UP: false });
  const [zoom, setZoom] = useState(14);
  // Follow mode keeps the map centred on the rider. Dragging the map disarms it
  // so the rider can look ahead; the Center-map button re-arms it.
  const [followMode, setFollowMode] = useState(true);
  const [isSimMode, setIsSimMode] = useState(false);
  const [simPath, setSimPath] = useState([]);
  const [simIndex, setSimIndex] = useState(0);
  const [simProgress, setSimProgress] = useState(0); // 0 to 1 between points
  const [activePolyline, setActivePolyline] = useState(null);
  const mapRef = useRef(null);
  const latestGpsStateRef = useRef({
    activeOrder: null,
    activePolyline: null,
    distanceToTarget: null,
    emitLocation: null,
    eta: null,
    isOnline: false,
    reachDrop: null,
    reachPickup: null,
    tripStatus: 'IDLE',
  });

  useEffect(() => {
    latestGpsStateRef.current = {
      activeOrder,
      activePolyline,
      distanceToTarget,
      emitLocation,
      eta,
      isOnline,
      reachDrop,
      reachPickup,
      tripStatus,
    };
  }, [activeOrder, activePolyline, distanceToTarget, emitLocation, eta, isOnline, reachDrop, reachPickup, tripStatus]);

  const publishTrackedLocation = useCallback((location, options = {}) => {
    const latest = latestGpsStateRef.current;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !latest.isOnline) {
      return;
    }

    const now = Number.isFinite(Number(location?.timestamp)) ? Number(location.timestamp) : Date.now();
    const heading = Number.isFinite(Number(location?.heading)) ? Number(location.heading) : 0;
    const speed = Number.isFinite(Number(location?.speed)) ? Number(location.speed) : 0;
    const accuracy = Number.isFinite(Number(location?.accuracy)) ? Number(location.accuracy) : null;
    const orderId = getTrackingKey(latest.activeOrder);

    deliveryAPI.updateLocation(lat, lng, true, {
      heading,
      speed,
      accuracy,
      source: options.source || 'web',
    }).catch(() => { });

    const deliveryPartnerId = deliveryPartnerIdRef.current || getStoredDeliveryPartnerId();
    deliveryPartnerIdRef.current = deliveryPartnerId;
    if (deliveryPartnerId) {
      writeDeliveryLocation({
        deliveryId: deliveryPartnerId,
        lat,
        lng,
        heading,
        speed,
        accuracy,
        isOnline: true,
        activeOrderId: orderId || null,
        timestamp: now
      }).catch(() => { });
    }

    if (!orderId) {
      return;
    }

    const payload = {
      lat,
      lng,
      heading,
      speed,
      accuracy,
      orderId,
      orderMongoId: orderId,
      orderFriendlyId: latest.activeOrder?.order_id || latest.activeOrder?.orderId || null,
      status: 'on_the_way',
      polyline: latest.activePolyline
    };

    latest.emitLocation?.(payload);

    writeOrderTracking(orderId, {
      lat,
      lng,
      heading,
      speed,
      accuracy,
      polyline: latest.activePolyline,
      status: latest.tripStatus,
      eta: latest.eta,
      timestamp: now
    }).catch(() => { });
  }, []);

  const ingestLocationUpdate = useCallback((location, options = {}) => {
    const latest = latestGpsStateRef.current;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }

    const now = Number.isFinite(Number(location?.timestamp)) ? Number(location.timestamp) : Date.now();
    let normalizedHeading = Number.isFinite(Number(location?.heading)) ? Number(location.heading) : null;
    if (normalizedHeading === null && lastCoordRef.current) {
      const moved = getHaversineDistance(lat, lng, lastCoordRef.current.lat, lastCoordRef.current.lng);
      if (moved >= 5) {
        normalizedHeading = calculateHeading(
          lastCoordRef.current.lat,
          lastCoordRef.current.lng,
          lat,
          lng,
        );
      }
    }
    if (normalizedHeading === null) {
      normalizedHeading = lastHeadingRef.current ?? 0;
    }
    lastHeadingRef.current = normalizedHeading;

    const normalizedSpeed = Number.isFinite(Number(location?.speed)) ? Number(location.speed) : 0;
    const accuracy = Number.isFinite(Number(location?.accuracy)) ? Number(location.accuracy) : null;

    setRiderLocation({ lat, lng, heading: normalizedHeading });

    if (normalizedSpeed > 0) {
      rollingSpeedRef.current = [...rollingSpeedRef.current.slice(-4), normalizedSpeed];
    }

    const withinArrivalRange =
      Number.isFinite(latest.distanceToTarget) && latest.distanceToTarget <= 100;

    if (
      latest.isOnline &&
      latest.activeOrder &&
      withinArrivalRange &&
      !lastAutoArrivalRef.current[latest.tripStatus]
    ) {
      if (latest.tripStatus === 'PICKING_UP') {
        lastAutoArrivalRef.current[latest.tripStatus] = true;
        latest.reachPickup?.().catch(() => { lastAutoArrivalRef.current[latest.tripStatus] = false; });
      } else if (latest.tripStatus === 'PICKED_UP') {
        lastAutoArrivalRef.current[latest.tripStatus] = true;
        latest.reachDrop?.().catch(() => { lastAutoArrivalRef.current[latest.tripStatus] = false; });
      }
    }

    if (latest.distanceToTarget > 200) {
      lastAutoArrivalRef.current[latest.tripStatus] = false;
    }

    const distMoved = lastCoordRef.current
      ? getHaversineDistance(lat, lng, lastCoordRef.current.lat, lastCoordRef.current.lng)
      : 1000;

    lastCoordRef.current = { lat, lng };
    lastFixAtRef.current = now;

    if (!latest.isOnline) {
      return true;
    }

    if (!options.force && distMoved < 25 && (now - lastLocationSentAt.current < 7000)) {
      return true;
    }

    lastLocationSentAt.current = now;
    publishTrackedLocation(
      {
        lat,
        lng,
        heading: normalizedHeading,
        speed: normalizedSpeed,
        accuracy,
        timestamp: now,
      },
      options,
    );

    return true;
  }, [publishTrackedLocation, setRiderLocation]);

  const handleFlutterLocation = useCallback((location, options = {}) => {
    const hasActiveOrder = Boolean(latestGpsStateRef.current.activeOrder);
    if (!hasActiveOrder) {
      return false;
    }
    setIsGpsOff(false);
    return ingestLocationUpdate(location, {
      ...options,
      source: options.source || 'flutter',
      force: true,
    });
  }, [ingestLocationUpdate]);

  const isLoggingOut = useRef(false);
  const handleLogout = useCallback(() => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;

    // 1. Clear tokens and state
    localStorage.removeItem('delivery_accessToken');
    localStorage.removeItem('delivery_refreshToken');
    localStorage.removeItem('delivery_authenticated');
    localStorage.removeItem('delivery_user');
    localStorage.removeItem('app:isOnline');
    window.dispatchEvent(new Event('deliveryAuthChanged'));

    // 2. Alert user and redirect
    toast.error("Session Expired", { description: "Please log in again." });
    navigate("/food/delivery/login", { replace: true });

    // Optional: Full refresh after delay ONLY if we're not already on login
    setTimeout(() => {
      if (!window.location.pathname.includes('/login')) {
        window.location.reload();
      }
    }, 1500);
  }, [navigate]);

  useEffect(() => {
    const onAuthFailure = (e) => {
      if (e.detail?.module === 'delivery') {
        handleLogout();
      }
    };
    window.addEventListener('authRefreshFailed', onAuthFailure);
    return () => window.removeEventListener('authRefreshFailed', onAuthFailure);
  }, [handleLogout]);

  // 0. Auto-Simulation Effect (High-Precision Smooth Glide)
  const lastSimUpdateSentAt = useRef(0);
  useEffect(() => {
    let interval;
    if (isSimMode && simPath.length > 1 && simIndex < simPath.length - 1) {
      console.log('[SimAuto] Glide Active √');

      interval = setInterval(() => {
        setSimProgress(prev => {
          const nextProgress = prev + 0.08; // 8% movement per tick

          if (nextProgress >= 1) {
            setSimIndex(idx => idx + 1);
            return 0; // Move to next segment
          }

          const currentPoint = simPath[simIndex];
          const nextPoint = simPath[simIndex + 1];

          if (currentPoint && nextPoint) {
            // Linear Interpolation (LERP)
            const lat = currentPoint.lat + (nextPoint.lat - currentPoint.lat) * nextProgress;
            const lng = currentPoint.lng + (nextPoint.lng - currentPoint.lng) * nextProgress;
            const heading = calculateHeading(currentPoint.lat, currentPoint.lng, nextPoint.lat, nextPoint.lng);

            setRiderLocation({ lat, lng, heading });

            if (mapRef.current) {
              mapRef.current.panTo({ lat, lng });
            }

            // Sync with backend every 2.5 seconds during simulation so customer sees it
            const now = Date.now();
            if (now - lastSimUpdateSentAt.current >= 2000) { // Reduced to 2s to match backend throttle
              lastSimUpdateSentAt.current = now;
              publishTrackedLocation(
                { lat, lng, heading, speed: 0, accuracy: null, timestamp: now },
                { source: 'simulation', force: true },
              );
            }
          }
          return nextProgress;
        });
      }, 50); // 20 FPS movement
    }
    return () => clearInterval(interval);
  }, [isSimMode, publishTrackedLocation, simIndex, simPath]);

  // Fetch Emergency numbers and Profile (Restored logic)
  useEffect(() => {
    (async () => {
      try {
        const [emergencyRes, profileRes] = await Promise.all([
          deliveryAPI.getEmergencyHelp(),
          deliveryAPI.getProfile()
        ]);
        if (emergencyRes?.data?.success && emergencyRes.data.data) {
          setEmergencyNumbers(emergencyRes.data.data);
        }
        if (profileRes?.data?.success && profileRes.data.data?.profile) {
          const profile = profileRes.data.data.profile;
          setProfileImage(profile.profileImage?.url || profile.documents?.photo || null);
        }
      } catch (err) { console.warn('Navbar Data Fetch Error:', err); }
    })();
  }, []);

  const emergencyOptions = [
    { title: "Medical Emergency", subtitle: "Call an ambulance", icon: <Ambulance className="text-red-600" />, phone: emergencyNumbers.medicalEmergency },
    { title: "Accident Helpline", subtitle: "Report an accident", icon: <AlertTriangle className="text-orange-600" />, phone: emergencyNumbers.accidentHelpline },
    { title: "Contact Police", subtitle: "Nearest police support", icon: <Shield className="text-blue-600" />, phone: emergencyNumbers.contactPolice },
    { title: "Insurance", subtitle: "Policy & claim help", icon: <ShieldCheck className="text-green-600" />, phone: emergencyNumbers.insurance },
  ];

  // Reset simulation when path, order or mode changes
  useEffect(() => {
    if (isSimMode) {
      console.log('[SimAuto] Resetting simulation playhead...');
      setSimIndex(0);
      setSimProgress(0);
    }
  }, [simPath, tripStatus, isSimMode]);

  // Auto-restore modal when status or content changes
  useEffect(() => {
    setIsModalMinimized(false);
  }, [tripStatus, showVerification, incomingOrder]);

  // 1. Initial Sync (Force sync with server to avoid 'stuck' persistent state)
  useEffect(() => {
    const syncWithServer = async () => {
      try {
        const response = await deliveryAPI.getCurrentDelivery();
        const rawData = response?.data?.data?.activeOrder || response?.data?.data;
        const serverData = (rawData && (rawData._id || rawData.orderId)) ? rawData : null;

        if (serverData) {
          // Robust location mapping (Same as acceptOrder logic)
          const getLoc = (ref, keysLat, keysLng) => {
            if (!ref) return null;
            if (ref.location) {
              if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
                return {
                  lat: ref.location.coordinates[1],
                  lng: ref.location.coordinates[0]
                };
              }
              return {
                lat: ref.location.latitude || ref.location.lat,
                lng: ref.location.longitude || ref.location.lng
              };
            }
            for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
            return null;
          };

          const resLoc = getLoc(serverData.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) ||
            getLoc(serverData, ['restaurant_lat', 'restaurantLat', 'latitude'], ['restaurant_lng', 'restaurantLng', 'longitude']);

          const cusLoc = getLoc(serverData.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) ||
            getLoc(serverData, ['customer_lat', 'customerLat', 'latitude'], ['customer_lng', 'customerLng', 'longitude']);

          const syncedOrder = {
            ...serverData,
            restaurantLocation: resLoc,
            customerLocation: cusLoc
          };

          const backendStatus = String(serverData.deliveryStatus || serverData.orderState?.status || serverData.orderStatus || serverData.status || '').toLowerCase();
          const currentPhase = String(serverData.deliveryState?.currentPhase || serverData.deliveryPhase || '').toLowerCase();

          let targetStatus = 'PICKING_UP';
          if (['delivered', 'completed'].includes(backendStatus) || ['delivered', 'completed'].includes(currentPhase)) {
            targetStatus = 'COMPLETED';
          } else if (['at_drop', 'reached_drop'].includes(currentPhase) || ['reached_drop', 'at_drop', 'reached_delivery', 'at_delivery'].includes(backendStatus)) {
            targetStatus = 'REACHED_DROP';
          } else if (['en_route_to_delivery', 'picked_up', 'out_for_delivery'].includes(currentPhase) || ['picked_up', 'out_for_delivery', 'delivering', 'en_route_to_delivery'].includes(backendStatus)) {
            targetStatus = 'PICKED_UP';
          } else if (['at_pickup', 'reached_pickup'].includes(currentPhase) || ['reached_pickup', 'at_pickup'].includes(backendStatus)) {
            targetStatus = 'REACHED_PICKUP';
          } else if (['en_route_to_pickup', 'created', 'confirmed', 'preparing', 'ready_for_pickup'].includes(currentPhase) || ['confirmed', 'preparing', 'ready_for_pickup', 'created', 'accepted', 'order_confirmed'].includes(backendStatus)) {
            targetStatus = 'PICKING_UP';
          } else {
            const currentStoreStatus = useDeliveryStore.getState().tripStatus;
            targetStatus = (currentStoreStatus && currentStoreStatus !== 'IDLE') ? currentStoreStatus : 'PICKING_UP';
          }

          setActiveOrder(syncedOrder, targetStatus);
          updateTripStatus(targetStatus);
        } else {
          clearActiveOrder();
        }
      } catch (err) {
        console.error('Order Sync Failed:', err);
        clearActiveOrder();
      }
    };
    syncWithServer();
  }, []); // Only on mount to stabilize state

  // 1.5 Professional Unified ETA Calculation Hook
  useEffect(() => {
    // If we have distance, calculate ETA. Fallback to 8m/s (28km/h) avg if GPS speed is unknown.
    if (distanceToTarget != null && distanceToTarget !== Infinity) {
      const avgSpeed = rollingSpeedRef.current.length > 0
        ? rollingSpeedRef.current.reduce((a, b) => a + b, 0) / rollingSpeedRef.current.length
        : 8;

      setEta(calculateETA(distanceToTarget, avgSpeed));
    } else {
      setEta(null);
    }
  }, [distanceToTarget]);

  // 2. Online/Offline Status Sync (Low Frequency)
  useEffect(() => {
    if (!isOnline) {
      deliveryAPI.updateOnlineStatus(false).catch(() => { });
    }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline) return;

    clearAllOffers();
    setIncomingOrder(null);
    setIsModalMinimized(false);
  }, [clearAllOffers, isOnline]);

  // 3. Location logic (Smart Frequency Tracking)
  useEffect(() => {
    if (isSimMode) {
      return;
    }

    if (!navigator.geolocation) {
      toast.error('GPS is not supported on this device.');
      return;
    }

    const handlePosition = (pos, options = {}) => {
      const latest = latestGpsStateRef.current;
      const { latitude: lat, longitude: lng, heading, speed } = pos.coords;
      const now = Date.now();
      // Many Android browsers report heading only while moving fast, and null
      // otherwise — which used to snap the bike icon due north. Fall back to the
      // bearing between the last two fixes before giving up and reusing the last
      // known heading.
      let normalizedHeading = Number.isFinite(heading) ? heading : null;
      if (normalizedHeading === null && lastCoordRef.current) {
        const moved = getHaversineDistance(lat, lng, lastCoordRef.current.lat, lastCoordRef.current.lng);
        // Below ~5 m the bearing is GPS noise, not a real direction.
        if (moved >= 5) {
          normalizedHeading = calculateHeading(
            lastCoordRef.current.lat, lastCoordRef.current.lng, lat, lng,
          );
        }
      }
      if (normalizedHeading === null) {
        normalizedHeading = lastHeadingRef.current ?? 0;
      }
      lastHeadingRef.current = normalizedHeading;
      const normalizedSpeed = Number.isFinite(speed) ? speed : 0;
      const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;

      setRiderLocation({ lat, lng, heading: normalizedHeading });

      if (normalizedSpeed > 0) {
        rollingSpeedRef.current = [...rollingSpeedRef.current.slice(-4), normalizedSpeed];
      }

      // Auto-arrival now runs in development too. It previously required
      // !import.meta.env.DEV while the proximity gate was force-unlocked in DEV,
      // so the two rules pointed in opposite directions and this path was only
      // ever exercised in production.
      //
      // It deliberately still requires REAL proximity, including in dev: the
      // bypass unlocks the manual buttons, it does not auto-advance the trip.
      // Simulation mode is how you drive this locally.
      const withinArrivalRange =
        Number.isFinite(latest.distanceToTarget) && latest.distanceToTarget <= 100;

      if (
        latest.isOnline &&
        latest.activeOrder &&
        withinArrivalRange &&
        !lastAutoArrivalRef.current[latest.tripStatus]
      ) {
        if (latest.tripStatus === 'PICKING_UP') {
          lastAutoArrivalRef.current[latest.tripStatus] = true;
          latest.reachPickup?.().catch(() => { lastAutoArrivalRef.current[latest.tripStatus] = false; });
        } else if (latest.tripStatus === 'PICKED_UP') {
          lastAutoArrivalRef.current[latest.tripStatus] = true;
          latest.reachDrop?.().catch(() => { lastAutoArrivalRef.current[latest.tripStatus] = false; });
        }
      }

      if (latest.distanceToTarget > 200) {
        lastAutoArrivalRef.current[latest.tripStatus] = false;
      }

      const distMoved = lastCoordRef.current
        ? getHaversineDistance(lat, lng, lastCoordRef.current.lat, lastCoordRef.current.lng)
        : 1000;

      lastCoordRef.current = { lat, lng };
      lastFixAtRef.current = now;

      if (!latest.isOnline) {
        return;
      }

      if (!options.force && distMoved < 25 && (now - lastLocationSentAt.current < 7000)) {
        return;
      }

      lastLocationSentAt.current = now;
      const payload = {
        lat,
        lng,
        heading: normalizedHeading,
        speed: normalizedSpeed,
        accuracy,
        orderId: getTrackingKey(latest.activeOrder),
        orderMongoId: getTrackingKey(latest.activeOrder),
        orderFriendlyId: latest.activeOrder?.order_id || latest.activeOrder?.orderId || null,
        status: 'on_the_way',
        polyline: latest.activePolyline
      };

      deliveryAPI.updateLocation(lat, lng, true, {
        heading: normalizedHeading,
        speed: normalizedSpeed,
        accuracy
      }).catch(() => { });

      const deliveryPartnerId = deliveryPartnerIdRef.current || getStoredDeliveryPartnerId();
      deliveryPartnerIdRef.current = deliveryPartnerId;
      if (deliveryPartnerId) {
        writeDeliveryLocation({
          deliveryId: deliveryPartnerId,
          lat,
          lng,
          heading: normalizedHeading,
          speed: normalizedSpeed,
          accuracy,
          isOnline: true,
          activeOrderId: payload.orderId || null,
          timestamp: now
        }).catch(() => { });
      }

      if (payload.orderId) latest.emitLocation?.(payload);

      if (payload.orderId) {
        writeOrderTracking(payload.orderId, {
          lat,
          lng,
          heading: normalizedHeading,
          polyline: latest.activePolyline,
          status: latest.tripStatus,
          eta: latest.eta
        }).catch(() => { });
      }
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGpsOff(false);
        ingestLocationUpdate({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
        }, { source: 'browser-initial', force: true });
      },
      (err) => handleGpsError(err),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8000
      }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setIsGpsOff(false);
        ingestLocationUpdate({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
        }, { source: 'browser-watch' });
      },
      (error) => handleGpsError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [handleGpsError, ingestLocationUpdate, isSimMode]);

  // 3.5. Background Ping / Heartbeat
  // If watchPosition stops firing (e.g. app in background or device stationary),
  // this ensures we ping the backend periodically. This keeps the token fresh (via 401 interceptor)
  // and keeps the Delivery Partner "online" in the backend.
  useEffect(() => {
    if (!isOnline) return;

    const pingInterval = setInterval(() => {
      const now = Date.now();

      // Only replay a coordinate that is still a RECENT measurement.
      //
      // This heartbeat re-sends the last known position so a stationary rider
      // stays online — but it also refreshes `lastLocationAt` server-side. If the
      // app stayed alive while GPS died (permission revoked, location services
      // off, backgrounded), it kept replaying one frozen coordinate forever and
      // dispatch saw a permanently "fresh" timestamp on an hours-old position,
      // defeating the stale-GPS exclusion. Past the cutoff we stop transmitting
      // and let the rider go stale, which is the truthful state.
      const fixAgeMs = now - lastFixAtRef.current;
      const fixIsUsable = lastFixAtRef.current > 0 && fixAgeMs <= STALE_FIX_CUTOFF_MS;

      if (!fixIsUsable && lastFixAtRef.current > 0) {
        setIsGpsOff(true);
      }

      if (now - lastLocationSentAt.current >= 15000 && lastCoordRef.current && fixIsUsable) {
        lastLocationSentAt.current = now;
        publishTrackedLocation({
          lat: lastCoordRef.current.lat,
          lng: lastCoordRef.current.lng,
          heading: lastHeadingRef.current ?? 0,
          speed: 0,
          accuracy: null,
          timestamp: now,
        }, { source: 'heartbeat', force: true });
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(pingInterval);
  }, [isOnline, publishTrackedLocation]);

  useEffect(() => {
    if (!isOnline || !newOrder || activeOrder) {
      setIncomingOrder(null);
      return;
    }

    setIncomingOrder(newOrder);
  }, [activeOrder, isOnline, newOrder]);

  useEffect(() => {
    if (activeOrder && incomingOrder) {
      setIncomingOrder(null);
      clearAllOffers();
    }
  }, [activeOrder, clearAllOffers, incomingOrder]);

  useEffect(() => {
    if (!isOnline) return;
    if (currentTab !== 'feed') return;
    if (activeOrder) return;

    let cancelled = false;

    const hydrateAvailableOrder = async () => {
      try {
        const currentResponse = await deliveryAPI.getCurrentDelivery();
        const currentPayload =
          currentResponse?.data?.data?.activeOrder ||
          currentResponse?.data?.data ||
          null;

        if (!cancelled && currentPayload && (currentPayload._id || currentPayload.orderId)) {
          setActiveOrder(currentPayload);
          return;
        }

        const availableResponse = await deliveryAPI.getOrders({ limit: 20, page: 1 });
        const availablePayload =
          availableResponse?.data?.data ||
          availableResponse?.data ||
          {};
        const availableOrders = Array.isArray(availablePayload?.docs)
          ? availablePayload.docs
          : Array.isArray(availablePayload?.items)
            ? availablePayload.items
            : Array.isArray(availablePayload)
              ? availablePayload
              : [];

        const nextIncomingOrder = availableOrders.find((order) => {
          const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
          const orderStatus = String(order?.orderStatus || order?.status || '').toLowerCase();
          return (
            ['unassigned', 'assigned'].includes(dispatchStatus) &&
            ['confirmed', 'preparing', 'ready_for_pickup'].includes(orderStatus)
          );
        });

        if (!cancelled && nextIncomingOrder) {
          // Only hydrate when there is no live offer already; do not overwrite the socket queue head.
          setIncomingOrder((prev) => {
            if (prev || newOrder) return prev;
            const prevId = prev?.orderId || prev?._id || prev?.orderMongoId;
            const nextId =
              nextIncomingOrder?.orderId ||
              nextIncomingOrder?._id ||
              nextIncomingOrder?.orderMongoId;
            return prevId === nextId && prev ? prev : nextIncomingOrder;
          });
        }
      } catch (error) {
        console.warn('[DeliveryHomeV2] Available order fallback sync failed:', error?.message || error);
      }
    };

    void hydrateAvailableOrder();
    const poller = window.setInterval(() => {
      if (!document.hidden) {
        void hydrateAvailableOrder();
      }
    }, isSocketConnected ? 30000 : 15000);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void hydrateAvailableOrder();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeOrder, currentTab, isOnline, isSocketConnected, newOrder, setActiveOrder]);

  useEffect(() => {
    if (orderStatusUpdate) {
      if (orderStatusUpdate.status === 'cancelled') {
        toast.error('Order cancelled');
        clearAllOffers();
        setIncomingOrder(null);
        resetTrip();
      } else if (orderStatusUpdate.status === 'deleted') {
        toast.error('Order removed');
        clearAllOffers();
        setIncomingOrder(null);
        resetTrip();
      } else if (orderStatusUpdate.status === 'deassigned') {
        clearAllOffers();
        setIncomingOrder(null);
        clearActiveOrder();
        setShowVerification(false);
        setIsModalMinimized(false);
        setActivePolyline(null);
        setSimPath([]);
        setSimIndex(0);
        setSimProgress(0);
        setEta(null);
        toast.info('Order reassigned by admin');
      }
      clearOrderStatusUpdate();
    }
  }, [
    orderStatusUpdate,
    resetTrip,
    clearOrderStatusUpdate,
    clearAllOffers,
    clearActiveOrder,
  ]);


  const handleCenterMap = () => {
    // Re-arm follow mode: this button is the rider's way back to "stay on me".
    setFollowMode(true);
    if (mapRef.current && useDeliveryStore.getState().riderLocation) {
      const loc = useDeliveryStore.getState().riderLocation;
      mapRef.current.panTo({
        lat: parseFloat(loc.lat || loc.latitude),
        lng: parseFloat(loc.lng || loc.longitude)
      });
    }
  };

  const handleMapClick = (lat, lng) => {
    if (activeOrder || incomingOrder || showVerification) {
      setIsModalMinimized(true);
    }
  };

  return (
    <div className={`relative h-screen w-full text-gray-900 overflow-hidden flex flex-col ${currentTab === 'pocket' ? 'bg-[#f8f9fa]' : 'bg-white'}`}>
      <FlutterLocationBridge
        enabled={Boolean(isOnline && activeOrder && !isSimMode)}
        orderId={getTrackingKey(activeOrder)}
        deliveryPartnerId={deliveryPartnerIdRef.current || getStoredDeliveryPartnerId()}
        onLocation={handleFlutterLocation}
      />
      {/* ─── 1. TOP HEADER (Ultra Premium Minimalist) ─── */}
      {currentTab === 'feed' && (
        <div className="absolute top-0 inset-x-0 z-[200] safe-top pointer-events-none">

          {/* Main Floating Dock */}
          <div className="px-4 pt-4 pointer-events-auto">
            <div className="bg-white backdrop-blur-md rounded-full p-1.5 flex items-center justify-between border border-gray-200 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
              <div className="flex items-center gap-3 pl-1">
                <div
                  onClick={() => navigate('/food/delivery/profile')}
                  className="w-10 h-10 rounded-full overflow-hidden cursor-pointer active:scale-95 transition-all bg-[#222]"
                >
                  <img src={profileImage || "https://cdn-icons-png.flaticon.com/512/3135/3135715.png"} alt="Profile" className="w-full h-full object-cover" />
                </div>

                <button
                  onClick={async () => {
                    const nextState = !isOnline;
                    if (!nextState) {
                      toggleOnline();
                      deliveryAPI.updateOnlineStatus(false).catch(() => { });
                      return;
                    }

                    if (!navigator.geolocation) {
                      setOnline(false);
                      toast.error('Turn on location to go online.');
                      return;
                    }

                    navigator.geolocation.getCurrentPosition(async (pos) => {
                      const latitude = Number(pos?.coords?.latitude);
                      const longitude = Number(pos?.coords?.longitude);
                      const hasValidLocation =
                        Number.isFinite(latitude) &&
                        Number.isFinite(longitude) &&
                        latitude >= -90 &&
                        latitude <= 90 &&
                        longitude >= -180 &&
                        longitude <= 180;

                      if (!hasValidLocation) {
                        setOnline(false);
                        toast.error('Turn on location to go online.');
                        return;
                      }

                      try {
                        await deliveryAPI.updateLocation(latitude, longitude, true);
                        setRiderLocation({
                          lat: latitude,
                          lng: longitude,
                          heading: pos.coords.heading || 0
                        });
                        setOnline(true);
                        setIsGpsOff(false);
                        setGpsErrorMessage('');
                        setIsGpsModalOpen(false);
                        const deliveryPartnerId = deliveryPartnerIdRef.current || getStoredDeliveryPartnerId();
                        deliveryPartnerIdRef.current = deliveryPartnerId;
                        if (deliveryPartnerId) {
                          writeDeliveryLocation({
                            deliveryId: deliveryPartnerId,
                            lat: latitude,
                            lng: longitude,
                            heading: pos.coords.heading || 0,
                            speed: pos.coords.speed || 0,
                            accuracy: pos.coords.accuracy,
                            isOnline: true,
                            activeOrderId: getTrackingKey(activeOrder) || null,
                            timestamp: Date.now()
                          }).catch(() => { });
                        }
                      } catch (error) {
                        setOnline(false);
                        toast.error(error?.response?.data?.message || 'Turn on location to go online.');
                      }
                    }, (err) => {
                      setOnline(false);
                      handleGpsError(err);
                      toast.error('Turn on location to go online.');
                    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
                  }}
                  className={`relative w-[110px] h-[34px] rounded-full p-1 transition-all duration-300 flex items-center ${isOnline ? 'bg-[#10b981]' : 'bg-[#2a2a2a]'}`}
                >
                  <div className={`relative z-10 flex items-center justify-between w-full px-2.5 text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'text-white' : 'text-gray-500'}`}>
                    <span className={isOnline ? 'opacity-100' : 'opacity-0'}>Online</span>
                    <span className={!isOnline ? 'opacity-100' : 'opacity-0'}>Offline</span>
                  </div>
                  <motion.div
                    initial={false}
                    animate={{ x: isOnline ? 76 : 0 }}
                    className={`absolute left-1 w-[26px] h-[26px] rounded-full shadow-sm flex items-center justify-center ${isOnline ? 'bg-white' : 'bg-[#111]'}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-1 pr-1.5">
                <button onClick={() => setShowEmergencyPopup(true)} className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 active:scale-90 transition-transform hover:text-gray-800"><AlertTriangle className="w-[20px] h-[20px]" /></button>
                <button onClick={() => navigate('/food/delivery/help/id-card')} className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 active:scale-90 transition-transform hover:text-gray-800"><Contact className="w-[20px] h-[20px]" /></button>
                <button onClick={() => navigate('/food/delivery/notifications')} className="relative w-10 h-10 rounded-full flex items-center justify-center text-gray-500 active:scale-90 transition-transform hover:text-gray-800">
                  <Bell className="w-[20px] h-[20px]" />
                  {notificationUnreadCount > 0 && <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#ef4444] border-2 border-white" />}
                </button>
              </div>
            </div>
          </div>

          {/* ─── LIVE STATUS / PROGRESS BADGE ─── */}
          <AnimatePresence>
            {currentTab === 'feed' && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="px-4 mt-3 pointer-events-auto"
              >
                {activeOrder ? null : (
                  <div className={`overflow-hidden rounded-[24px] p-4 flex items-center gap-4 transition-all duration-300 ${isOnline ? 'bg-[#111111]/95 border border-white/10' : 'bg-[#111111]/90 border border-white/5'} backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.4)]`}>
                    <div className="relative flex items-center justify-center shrink-0">
                      <div className={`w-3.5 h-3.5 rounded-full ${isOnline ? 'bg-[#10b981]' : 'bg-gray-600'}`} />
                      {isOnline && <div className="absolute w-full h-full bg-[#10b981] rounded-full animate-ping opacity-60" />}
                    </div>

                    <div className="flex flex-col">
                      <h3 className={`font-semibold text-[15px] tracking-tight leading-none mb-1.5 ${isOnline ? 'text-white' : 'text-gray-400'}`}>
                        {isOnline ? 'Finding orders near you' : 'You are offline'}
                      </h3>
                      <p className="text-gray-500 text-[13px] font-medium leading-none">
                        {isOnline ? 'Keep the app open to receive requests' : 'Go online to start earning'}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ─── 2. MAIN CONTENT ─── */}
      <div className={`flex-1 relative overflow-y-auto ${currentTab === 'feed' ? 'pt-[120px]' : 'pt-0'} no-scrollbar`}>
        {currentTab === 'feed' ? (
          <div className="absolute inset-0 top-[-120px]">
            <LiveMap
              onMapLoad={(m) => mapRef.current = m}
              onMapClick={handleMapClick}
              onPathReceived={setSimPath}
              onPolylineReceived={(poly) => {
                setActivePolyline(poly);
                // If we have an order, push the INITIAL polyline to Firebase immediately for the customer
                const orderId = getTrackingKey(activeOrder);
                if (orderId && poly) {
                  writeOrderTracking(orderId, { polyline: poly, status: tripStatus, eta: eta }).catch(() => { });
                }
              }}
              zoom={zoom}
              followMode={followMode}
              onFollowModeChange={setFollowMode}
            />

            {/* SIMULATION INDICATOR (Removed from top) */}

            <div className="absolute right-4 bottom-[200px] transition-all duration-500 flex flex-col items-end gap-3 z-[120] pointer-events-none">

              {/* Compact Simulation Pill */}
              <AnimatePresence>
                {isSimMode && (
                  <motion.div
                    initial={{ opacity: 0, x: 20, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-[#111111]/90 backdrop-blur-md rounded-full p-1.5 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-auto flex items-center gap-2 pr-2"
                  >
                    <div className="w-9 h-9 bg-orange-500/20 rounded-full flex items-center justify-center animate-pulse border border-orange-500/30 shrink-0">
                      <Play className="w-3.5 h-3.5 text-orange-400 fill-current ml-0.5" />
                    </div>
                    <div className="flex flex-col pr-1">
                      <span className="text-orange-400 text-[8px] font-black uppercase tracking-widest leading-none mb-0.5">Auto-Nav</span>
                      <span className="text-white text-[9px] font-bold tracking-wider opacity-80 leading-none">Simulating...</span>
                    </div>
                    <button onClick={() => setIsSimMode(false)} className="w-8 h-8 ml-1 bg-white/5 active:bg-white/10 hover:bg-red-500/20 group rounded-full flex items-center justify-center border border-white/10 transition-all active:scale-90 shrink-0">
                      <div className="w-2.5 h-2.5 bg-gray-400 group-hover:bg-red-500 rounded-[2px] transition-colors" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Zoom Controls */}
              <div className="flex flex-col bg-[#111111]/90 backdrop-blur-md rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/10 overflow-hidden pointer-events-auto">
                <button onClick={() => setZoom(z => Math.min(22, z + 1))} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 border-b border-white/10 text-gray-300 active:bg-white/20 transition-colors" aria-label="Zoom in"><Plus className="w-5 h-5 stroke-[2.75]" /></button>
                <button onClick={() => setZoom(z => Math.max(8, z - 1))} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 text-gray-300 active:bg-white/20 transition-colors" aria-label="Zoom out"><Minus className="w-5 h-5 stroke-[2.75]" /></button>
              </div>

              {/* Simulation Mode Toggle */}
              <button
                onClick={() => {
                  const nextSimState = !isSimMode;
                  setIsSimMode(nextSimState);

                  if (nextSimState) {
                    toast.warning('Simulation Mode Active');
                    // Initialize position if null
                    if (!useDeliveryStore.getState().riderLocation && activeOrder) {
                      const target = activeOrder.restaurantLocation || activeOrder.customerLocation;
                      if (target) {
                        setRiderLocation({
                          lat: parseFloat(target.lat || target.latitude) + 0.001,
                          lng: parseFloat(target.lng || target.longitude) + 0.001,
                          heading: 0
                        });
                      }
                    }
                  }
                }}
                className={`w-12 h-12 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-center border transition-all pointer-events-auto active:scale-90 ${isSimMode ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' : 'bg-[#111111]/90 backdrop-blur-md border-white/10 text-emerald-400 hover:bg-white/10'}`}
              >
                <div className={`w-7 h-7 rounded-full border-[1.5px] flex items-center justify-center ${isSimMode ? 'border-orange-400' : 'border-emerald-400'}`}>
                  <Play className={`w-3.5 h-3.5 fill-current ml-0.5 ${isSimMode ? 'animate-pulse' : ''}`} />
                </div>
              </button>

              {/* Free Navigate */}
              <button
                onClick={() => mapRef.current?.setOptions({ gestureHandling: 'greedy' })}
                className="w-12 h-12 bg-[#111111]/90 backdrop-blur-md rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-center text-blue-400 border border-white/10 active:scale-90 active:bg-white/20 hover:bg-white/10 transition-all pointer-events-auto"
              >
                <div className="w-7 h-7 rounded-full border-[1.5px] border-blue-400 flex items-center justify-center"><Navigation2 className="w-3.5 h-3.5" /></div>
              </button>

              {/* Center Map */}
              <button
                onClick={handleCenterMap}
                className="w-12 h-12 bg-[#111111]/90 backdrop-blur-md rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-center text-gray-300 border border-white/10 active:scale-90 active:bg-white/20 hover:bg-white/10 transition-all pointer-events-auto"
              >
                <Target className="w-6 h-6" />
              </button>
            </div>
          </div>
        ) : currentTab === 'pocket' ? (
          <PocketV2 />
        ) : currentTab === 'history' ? (
          <HistoryV2 />
        ) : (
          <ProfileV2 />
        )}

        {/* OVERLAYS (Persistent if active) */}
      </div>

      {/* OVERLAYS (Persistent if active) - Outside flex container to avoid clipping and z-index issues */}
      {(currentTab === 'feed' || activeOrder) && (
        <AnimatePresence>
          {!isModalMinimized && (
            <motion.div
              key="modal-container"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-0 z-[300] pointer-events-none flex items-end"
            >
              <div className="w-full pointer-events-auto relative">
                {incomingOrder && (
                  <NewOrderModal
                    key={getOrderRaceKey(incomingOrder) || 'incoming-order'}
                    order={incomingOrder}
                    riderLocation={riderLocation}
                    acceptDisabled={acceptingOrderKey === getOrderRaceKey(incomingOrder)}
                    onAccept={async (o) => {
                      const orderToAccept = o || incomingOrder;
                      const orderKey = getOrderRaceKey(orderToAccept);
                      if (!orderKey || acceptingOrderKey) return;
                      setAcceptingOrderKey(orderKey);
                      try {
                        await acceptOrder(orderToAccept);
                        clearAllOffers();
                        setIncomingOrder(null);
                      } catch (error) {
                        if (isAcceptRaceLoss(error)) {
                          setIncomingOrder(null);
                          clearNewOrder({ advance: true });
                        }
                        // Keep the current offer visible for transient network failures.
                      } finally {
                        setAcceptingOrderKey(null);
                      }
                    }}
                    onReject={async (action = 'rejected') => {
                      const orderToReject = incomingOrder;
                      // Persist pass/timeout so refresh does not resurrect this rider's offer.
                      try {
                        if (orderToReject) {
                          await rejectOrder(orderToReject, { action });
                        }
                        setIncomingOrder(null);
                        clearNewOrder({ advance: true });
                      } catch (_) {
                        // Keep the offer visible if the server did not record the pass/timeout.
                      }
                    }}
                    onMinimize={() => setIsModalMinimized(true)}
                  />
                )}
                {(tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') && (
                  <PickupActionModal
                    order={activeOrder}
                    status={tripStatus}
                    isWithinRange={isWithinRange}
                    distanceToTarget={distanceToTarget}
                    eta={eta}
                    onReachedPickup={reachPickup}
                    onPickedUp={(billImageUrl) => pickUpOrder(billImageUrl)}
                    onMinimize={() => setIsModalMinimized(true)}
                  />
                )}
                {(tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') && (
                  <div className="absolute inset-0 z-[120] flex items-end justify-center pointer-events-none">
                    {tripStatus === 'PICKED_UP' ? (
                      <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="w-full max-w-lg bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] pointer-events-auto overflow-hidden"
                      >
                        {/* Handle / Minimize */}
                        <div className="w-full flex justify-center py-3 bg-white relative z-20">
                          <button
                            onClick={() => setIsModalMinimized(true)}
                            className="w-12 h-1.5 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors active:scale-95"
                          />
                        </div>

                        <div className="flex-1 overflow-y-auto no-scrollbar p-8 pt-4">
                          <div className="flex justify-between w-full items-center mb-8">
                            <div className="flex items-start gap-3 flex-1 min-w-0 pr-2">
                              <div className="w-14 h-14 bg-emerald-50 rounded-[1.25rem] flex items-center justify-center shrink-0 shadow-inner border border-emerald-100 ring-2 ring-white">
                                <Target className="w-7 h-7 text-emerald-500" />
                              </div>
                              <div className="flex-1 min-w-0 pt-0.5">
                                <h3 className="text-gray-950 text-xl font-black tracking-tight leading-tight mb-1 truncate">Handover</h3>
                                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-2.5">Order #{activeOrder?.shortId || activeOrder?.orderId || activeOrder?._id?.slice(-6) || 'N/A'}</p>
                                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border shrink-0 ${isWithinRange ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isWithinRange ? 'bg-emerald-500 animate-pulse' : 'bg-orange-500'}`} />
                                  <span className={`text-[9px] font-black uppercase tracking-widest whitespace-nowrap truncate ${isWithinRange ? 'text-emerald-600' : 'text-orange-500'}`}>
                                    {isWithinRange ? 'Ready to Drop' : `${(distanceToTarget / 1000).toFixed(1)} km • ${eta || '--'} min`}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2.5 shrink-0">
                              {(() => {
                                const customerPhone = activeOrder?.userPhone || activeOrder?.user?.phone || activeOrder?.deliveryAddress?.phone || activeOrder?.deliveryAddress?.contactNumber || '';
                                return customerPhone ? (
                                  <button
                                    onClick={() => window.location.href = `tel:${customerPhone}`}
                                    className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-colors active:scale-90 shrink-0"
                                  >
                                    <Phone className="w-5 h-5" />
                                  </button>
                                ) : null;
                              })()}
                              {(() => {
                                const deliveryAddress = activeOrder?.deliveryAddress || {};
                                const geoCoords =
                                  Array.isArray(deliveryAddress.location?.coordinates) &&
                                  deliveryAddress.location.coordinates.length >= 2
                                    ? {
                                        lng: deliveryAddress.location.coordinates[0],
                                        lat: deliveryAddress.location.coordinates[1],
                                      }
                                    : null;
                                const customerLocation = activeOrder?.customerLocation || activeOrder?.deliveryLocation || geoCoords || null;
                                if (customerLocation?.lat != null && customerLocation?.lng != null) {
                                  return (
                                    <button
                                      onClick={() => openNavigation(customerLocation)}
                                      className="w-11 h-11 rounded-2xl bg-gray-950 flex items-center justify-center text-white shadow-xl hover:bg-gray-800 transition-colors active:scale-90 shrink-0"
                                    >
                                      <Navigation className="w-5 h-5" />
                                    </button>
                                  );
                                }
                                const addressPartsFromSchema = [
                                  deliveryAddress.street,
                                  deliveryAddress.additionalDetails,
                                  deliveryAddress.city,
                                  deliveryAddress.state,
                                  deliveryAddress.zipCode,
                                ]
                                  .map((v) => String(v || '').trim())
                                  .filter(Boolean);
                                const customerAddress =
                                  activeOrder?.customerAddress ||
                                  activeOrder?.customer_address ||
                                  (addressPartsFromSchema.length ? addressPartsFromSchema.join(', ') : '');
                                if (customerAddress) {
                                  return (
                                    <button
                                      onClick={() => openNavigation(null, customerAddress)}
                                      className="w-11 h-11 rounded-2xl bg-gray-950 flex items-center justify-center text-white shadow-xl hover:bg-gray-800 transition-colors active:scale-90 shrink-0"
                                    >
                                      <Navigation className="w-5 h-5" />
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>

                          {/* Customer Instructions Panel */}
                          {activeOrder?.note && (
                            <div className="w-full bg-linear-to-br from-orange-50/50 to-amber-50/50 border border-orange-100 rounded-[2rem] p-6 mb-8 flex gap-4 items-start relative overflow-hidden group">
                              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Package className="w-16 h-16" />
                              </div>
                              <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center text-orange-600 shadow-sm shrink-0 border border-orange-50 relative z-10">
                                <Package className="w-5 h-5" />
                              </div>
                              <div className="relative z-10">
                                <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] mb-1.5">Drop Message</p>
                                <p className="text-sm font-bold text-gray-950 leading-relaxed italic">"{activeOrder.note}"</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="p-8 pt-0 pb-12 bg-white border-t border-gray-50">
                          <div className="pt-6">
                            <ActionSlider
                              label="Slide to Arrive"
                              successLabel="Arrived ✓"
                              disabled={!isWithinRange}
                              onConfirm={reachDrop}
                              color="bg-emerald-600"
                            />
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="absolute bottom-[96px] left-5 right-5 pointer-events-auto z-[250] flex justify-center">
                         <motion.div 
                           initial={{ y: 50, opacity: 0 }}
                           animate={{ y: 0, opacity: 1 }}
                           transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                           className="w-full max-w-[400px] bg-[#111111]/95 backdrop-blur-xl border border-white/10 p-2 rounded-[32px] shadow-[0_24px_50px_rgba(0,0,0,0.8)]"
                         >
                            <button 
                              onClick={() => setShowVerification(true)} 
                              className="w-full bg-gradient-to-br from-emerald-400 to-emerald-600 border border-emerald-400/30 text-white rounded-[26px] py-4 font-black text-[13px] tracking-[0.2em] transform transition-all active:scale-[0.98] flex items-center justify-center gap-3 relative overflow-hidden group shadow-[0_8px_20px_rgba(16,185,129,0.3)]"
                            >
                              <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                              <CheckCircle2 className="w-[20px] h-[20px] relative z-10 drop-shadow-md" /> 
                              <span className="relative z-10 drop-shadow-md">VERIFY & COMPLETE</span>
                            </button>
                         </motion.div>
                      </div>
                    )}
                  </div>
                )}
                {showVerification && tripStatus !== 'COMPLETED' && (
                  <DeliveryVerificationModal
                    order={activeOrder}
                    onComplete={async (otp) => {
                      const res = await completeDelivery(otp);
                      setShowVerification(false);
                      return res;
                    }}
                    onClose={() => setShowVerification(false)}
                  />
                )}
                {tripStatus === 'COMPLETED' && <OrderSummaryModal order={activeOrder} onDone={resetTrip} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* ─── MODALS RESTORED FROM OLD UI ─── */}
      <BottomPopup isOpen={showEmergencyPopup} title="Emergency Help" onClose={() => setShowEmergencyPopup(false)}>
        <div className="grid gap-4 py-2">
          {emergencyOptions.map((opt, i) => (
            <button
              key={i}
              onClick={() => {
                const rawNum = opt.phone || "";
                const num = String(rawNum).replace(/[^\d+]/g, '');
                if (num.length >= 3) {
                  window.location.href = `tel:${num}`;
                } else {
                  toast.error(`${opt.title} number not configured`);
                }
              }}
              className="flex items-center gap-5 p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 active:scale-95 transition-all text-left"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-xl">{opt.icon}</div>
              <div>
                <h4 className="font-bold text-gray-900">{opt.title}</h4>
                <p className="text-xs text-gray-500 font-medium">{opt.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      </BottomPopup>

      {/* Floating Minimize/Restore Toggle - Above navbar */}
      {isModalMinimized && (activeOrder || incomingOrder || showVerification) && (
        <motion.div 
           initial={{ y: 100, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="fixed bottom-[100px] inset-x-0 z-[300] px-5"
        >
           <button 
             onClick={() => setIsModalMinimized(false)}
             className="w-full bg-[#111111]/95 text-white rounded-[24px] p-4 flex items-center justify-between shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-md border border-white/10 active:scale-[0.98] transition-transform"
           >
              <div className="flex flex-col items-start">
                 <div className="flex items-center gap-2 mb-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-orange-400 leading-none">Action Pending</span>
                 </div>
                 <span className="text-sm font-bold tracking-wide text-white leading-none mt-1">Open Delivery Panel</span>
              </div>
              <div className="w-10 h-10 bg-white/10 rounded-full text-white flex items-center justify-center border border-white/10 shrink-0 shadow-inner">
                 <Plus className="w-5 h-5" />
              </div>
           </button>
        </motion.div>
      )}

      {/* ─── 3. BOTTOM NAV (Ultra Premium Minimalist Island) ─── */}
      <div className="absolute bottom-0 left-0 right-0 w-full pb-8 pt-2 flex justify-center z-[200] bg-transparent pointer-events-none">
        <div className="bg-white border border-gray-200 rounded-full p-1.5 flex items-center shadow-[0_8px_32px_rgba(0,0,0,0.12)] pointer-events-auto">
          {[
            { id: 'feed', icon: LayoutGrid, label: 'Feed' },
            { id: 'pocket', icon: Wallet, label: 'Pocket' },
            { id: 'history', icon: History, label: 'History' },
            { id: 'profile', icon: UserIcon, label: 'Profile' }
          ].map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/food/delivery/${item.id}`)}
                className={`relative flex items-center justify-center h-12 transition-all duration-500 ease-out rounded-full ${isActive ? 'bg-gray-100 px-5 shadow-inner border border-gray-200' : 'w-12 px-0 text-gray-400 hover:text-gray-600'}`}
              >
                <Icon
                  className="w-5 h-5 shrink-0 transition-all duration-500"
                  style={isActive ? { color: "var(--module-theme-color, #00B761)" } : undefined}
                />
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      key="text"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden whitespace-nowrap flex items-center"
                    >
                      <span className="ml-2 text-[11px] font-black uppercase tracking-wider text-gray-800">
                        {item.label}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── ENABLE GPS MODAL ─── */}
      <EnableGpsModal
        isOpen={isGpsModalOpen}
        onClose={() => setIsGpsModalOpen(false)}
        errorMessage={gpsErrorMessage}
      />
    </div>
  );
}
