import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UtensilsCrossed, ChevronRight, X, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CookingAnimation = memo(() => (
  <div className="relative w-12 h-12 flex items-center justify-center rounded-xl bg-orange-50 border border-orange-100 overflow-visible shadow-[0_4px_15px_rgba(235,89,14,0.15)] shrink-0">
    <div className="absolute -top-3 flex gap-1.5">
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -8, -12], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/60 rounded-full blur-[1px]" />
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -10, -15], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.5, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/60 rounded-full blur-[1px]" />
      <motion.div animate={{ opacity: [0, 0.8, 0], y: [0, -8, -12], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity, delay: 1, ease: "easeOut" }} className="w-1.5 h-3 bg-orange-400/60 rounded-full blur-[1px]" />
    </div>
    <motion.div animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }} className="relative z-10 mt-1">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500 drop-shadow-sm">
        {/* Cooker Body */}
        <path d="M6 10h12v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-6z" />
        {/* Lid Rim */}
        <rect x="5" y="8" width="14" height="2" rx="1" />
        {/* Pressure Whistle (Top) */}
        <path d="M12 8V5" />
        <path d="M11 5h2v2h-2z" fill="currentColor" />
        {/* Main Handle (Right) */}
        <path d="M19 9l3-1v2l-3 1" fill="currentColor" strokeWidth="1" />
        {/* Sub Handle (Left) */}
        <path d="M5 10H3v2h2" />
      </svg>
    </motion.div>
    {/* Flame below */}
    <motion.div animate={{ opacity: [0.4, 0.8, 0.4], scaleX: [0.8, 1.2, 0.8] }} transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-0 w-full flex justify-center z-0">
      <div className="w-4 h-1 bg-orange-500 blur-[2px] rounded-full" />
    </motion.div>
  </div>
));

import { useOrders } from "@food/context/OrdersContext";
import { orderAPI } from "@food/api";

const getOrderKey = (order) => order?.id || order?._id || order?.orderId || null;

const getOrderStatus = (order) =>
  String(order?.orderStatus || order?.status || order?.deliveryState?.status || "").toLowerCase();

const getOrderPhase = (order) =>
  String(order?.deliveryState?.currentPhase || "").toLowerCase();

const ACTIVE_PHASES = new Set([
  "created",
  "confirmed",
  "preparing",
  "accepted",
  "ready",
  "ready_for_pickup",
  "reached_pickup",
  "picked_up",
  "out_for_delivery",
  "en_route_to_delivery",
  "at_pickup",
  "at_drop",
]);

/** Orders that should show the live tracking strip (any in-flight order, not terminal). */
const TERMINAL_STATUSES = new Set([
  "delivered",
  "cancelled",
  "completed",
  "failed",
  "cancelled_by_user",
  "cancelled_by_restaurant",
  "cancelled_by_admin",
]);

const isActiveOrder = (order) => {
  if (!order) return false;
  const status = getOrderStatus(order);
  const phase = getOrderPhase(order);
  if (TERMINAL_STATUSES.has(status)) return false;
  if (phase === "completed" || phase === "delivered") return false;
  // Some refresh payloads provide live phase but sparse status; keep tracking visible.
  if (!status && phase) return ACTIVE_PHASES.has(phase);
  if (!status) return false;
  return true;
};

const getTimeRemaining = (order) => {
  if (!order) return null;

  const orderTime = new Date(
    order.createdAt || order.orderDate || order.created_at || order.date || Date.now(),
  );
  const estimatedMinutes =
    order.estimatedDeliveryTime ||
    order.estimatedTime ||
    order.estimated_delivery_time ||
    35;
  const deliveryTime = new Date(orderTime.getTime() + estimatedMinutes * 60000);
  return Math.max(0, Math.floor((deliveryTime - new Date()) / 60000));
};

/** Cheap fingerprint so we skip setState when list content is unchanged (fewer re-renders). */
function ordersFingerprint(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return "";
  return orders
    .map((o) => `${getOrderKey(o)}:${getOrderStatus(o)}`)
    .join("|");
}

function OrderTrackingCardInner({ hasBottomNav = true }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { orders: contextOrders } = useOrders();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [apiOrders, setApiOrders] = useState([]);
  const [hasFetchedApi, setHasFetchedApi] = useState(false);
  const [activeOrderOverride, setActiveOrderOverride] = useState(null);
  const lastRefreshRef = useRef(0);
  const lastApiFingerprintRef = useRef("");
  const activeOrderKeyRef = useRef("");
  const activeOrderSnapshotRef = useRef(null);
  const [invalidOrderIds, setInvalidOrderIds] = useState(new Set());

  const fetchOrders = useCallback(async () => {
    try {
      const response = await orderAPI.getOrders({ limit: 10, page: 1 });
      let nextOrders = [];

      if (response?.data?.success && response?.data?.data?.orders) {
        nextOrders = response.data.data.orders;
      } else if (response?.data?.orders) {
        nextOrders = response.data.orders;
      } else if (response?.data?.data?.data && Array.isArray(response.data.data.data)) {
        nextOrders = response.data.data.data;
      } else if (response?.data?.data?.docs && Array.isArray(response.data.data.docs)) {
        nextOrders = response.data.data.docs;
      } else if (response?.data?.data && Array.isArray(response.data.data)) {
        nextOrders = response.data.data;
      }

      const list = Array.isArray(nextOrders) ? nextOrders : [];
      const fp = ordersFingerprint(list);
      if (fp !== lastApiFingerprintRef.current) {
        lastApiFingerprintRef.current = fp;
        setApiOrders(list);
      }
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("user_accessToken");
        localStorage.removeItem("accessToken");
      }
      if (lastApiFingerprintRef.current !== "") {
        lastApiFingerprintRef.current = "";
        setApiOrders([]);
      }
    } finally {
      setHasFetchedApi(true);
    }
  }, []);

  useEffect(() => {
    const onOrdersListingPage =
      typeof location?.pathname === "string" &&
      location.pathname.startsWith("/food/user/orders") &&
      !/^\/food\/user\/orders\/[^/]+/.test(location.pathname);

    fetchOrders();
    if (onOrdersListingPage) return undefined;

    const pollOrders = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchOrders();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        fetchOrders();
      }
    };

    const interval = setInterval(pollOrders, 30000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchOrders, location.pathname]);

  const uniqueOrders = useMemo(() => {
    const isMongoObjectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ""));
    const serverKeys = new Set(
      (apiOrders || []).map((o) => String(getOrderKey(o) || "")).filter(Boolean),
    );
    const seen = new Set();

    return [...apiOrders, ...contextOrders].filter((order) => {
      const key = getOrderKey(order);
      if (!key || seen.has(key)) {
        return false;
      }
      if (invalidOrderIds.has(key)) {
        return false;
      }
      // After first API sync, ignore stale local Mongo-like ids that are absent server-side.
      // This prevents repeated verification calls for already-deleted orders.
      if (
        hasFetchedApi &&
        isMongoObjectId(key) &&
        !serverKeys.has(String(key))
      ) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [contextOrders, apiOrders, invalidOrderIds, hasFetchedApi]);

  const activeOrder = useMemo(() => {
    const candidate = uniqueOrders.find((order) => isActiveOrder(order)) || null;
    if (!candidate) return null;
    const overrideKey = getOrderKey(activeOrderOverride);
    const candidateKey = getOrderKey(candidate);
    if (overrideKey && candidateKey && overrideKey === candidateKey) return activeOrderOverride;
    return candidate;
  }, [uniqueOrders, activeOrderOverride]);

  useEffect(() => {
    const key = String(getOrderKey(activeOrder) || "");
    activeOrderKeyRef.current = key;
    activeOrderSnapshotRef.current = activeOrder;
  }, [activeOrder]);

  useEffect(() => {
    const handleOrderStatusNotification = async (event) => {
      const detail = event?.detail || {};
      const incomingKey = String(detail?.orderMongoId || detail?.orderId || "").trim();
      const currentKey = activeOrderKeyRef.current;
      if (!incomingKey || !currentKey) return;
      if (incomingKey !== currentKey) return;

      const snap = activeOrderSnapshotRef.current;

      setActiveOrderOverride((prev) => ({
        ...(prev || snap || {}),
        orderStatus: detail?.orderStatus || prev?.orderStatus || snap?.orderStatus,
        deliveryState: detail?.deliveryState
          ? { ...(prev?.deliveryState || snap?.deliveryState || {}), ...detail.deliveryState }
          : prev?.deliveryState || snap?.deliveryState,
        status: detail?.status || prev?.status || snap?.status,
      }));

      const now = Date.now();
      if (now - lastRefreshRef.current < 1500) return;
      lastRefreshRef.current = now;

      try {
        const response = await orderAPI.getOrderDetails(incomingKey);
        const fresh = response?.data?.data?.order || response?.data?.order || response?.data?.data || null;
        if (fresh) setActiveOrderOverride(fresh);
      } catch (error) {
        if (error?.response?.status === 404 || error?.response?.status === 400) {
          setInvalidOrderIds((prev) => {
            const next = new Set(prev);
            next.add(incomingKey);
            return next;
          });
        }
      }
    };

    const handleOrderPlaced = () => {
      fetchOrders();
    };

    const handleOrderRated = (event) => {
      const detail = event?.detail || {};
      const ratedId = detail?.orderId || detail?.id;
      if (ratedId) {
        setDismissedKey(String(ratedId));
      }
      fetchOrders();
    };

    window.addEventListener("orderStatusNotification", handleOrderStatusNotification);
    window.addEventListener("order-placed", handleOrderPlaced);
    window.addEventListener("order-rated", handleOrderRated);

    return () => {
      window.removeEventListener("orderStatusNotification", handleOrderStatusNotification);
      window.removeEventListener("order-placed", handleOrderPlaced);
      window.removeEventListener("order-rated", handleOrderRated);
    };
  }, [fetchOrders]);

  useEffect(() => {
    if (!activeOrder) {
      setTimeRemaining((prev) => (prev !== null ? null : prev));
      return;
    }

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const next = getTimeRemaining(activeOrder);
      setTimeRemaining((prev) => (prev === next ? prev : next));
    };

    tick();
    const interval = setInterval(tick, 60000);
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        const next = getTimeRemaining(activeOrder);
        setTimeRemaining((prev) => (prev === next ? prev : next));
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeOrder]);

  // Proactive verification for active orders not found in recent API list
  useEffect(() => {
    const key = getOrderKey(activeOrder);
    if (!key || invalidOrderIds.has(key)) return;

    // If order is present in the recent server-provided list, we consider it valid without extra check
    const isRecentlyConfirmed = apiOrders.some((o) => getOrderKey(o) === key);
    if (isRecentlyConfirmed) return;

    const verifyOrderExists = async () => {
      try {
        await orderAPI.getOrderDetails(key);
      } catch (error) {
        if (error?.response?.status === 404 || error?.response?.status === 400) {
          setInvalidOrderIds((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        }
      }
    };

    verifyOrderExists();
  }, [activeOrder, apiOrders, invalidOrderIds]);

  const [dismissedKey, setDismissedKey] = useState(null);

  const deliveredOrderToRate = useMemo(() => {
    if (activeOrder) return null;
    return (uniqueOrders || []).find((order) => {
      const s = getOrderStatus(order);
      const p = getOrderPhase(order);
      const isDelivered = s === "delivered" || s === "completed" || p === "delivered" || p === "completed";
      if (!isDelivered) return false;

      const key = order.id || order._id || order.orderId;
      if (!key) return false;

      const hasRestaurantRating = Number.isFinite(Number(order.restaurantRating));
      const hasDeliveryPartner = !!(order.deliveryPartnerId || order.deliveryPartnerName || order.deliveryPartner);
      const hasDeliveryRating = Number.isFinite(Number(order.deliveryPartnerRating));
      const isAlreadyRated = order.rating || (hasRestaurantRating && (!hasDeliveryPartner || hasDeliveryRating));
      if (isAlreadyRated) return false;

      const isDismissed =
        dismissedKey === key ||
        localStorage.getItem("dismissed_rating_" + key) === "true" ||
        localStorage.getItem("dismissed_card_" + key) === "true";
      if (isDismissed) return false;

      return true;
    }) || null;
  }, [activeOrder, uniqueOrders, dismissedKey]);

  const targetOrder = activeOrder || deliveredOrderToRate;
  if (!targetOrder) {
    return null;
  }

  const isRatingPrompt = !activeOrder && !!deliveredOrderToRate;
  const currentOrderKey = targetOrder.id || targetOrder._id || targetOrder.orderId;
  if (dismissedKey === currentOrderKey) {
    return null;
  }

  const orderStatus = getOrderStatus(targetOrder) || "preparing";
  const orderPhase = getOrderPhase(targetOrder);

  const restaurantName =
    targetOrder.restaurantId?.restaurantName ||
    targetOrder.restaurantId?.name ||
    targetOrder.restaurantName ||
    targetOrder.restaurant_name ||
    targetOrder.restaurant ||
    "Restaurant";

  const restaurantImage = (() => {
    const img =
      targetOrder.restaurantId?.profileImage ||
      targetOrder.restaurantId?.logo ||
      targetOrder.restaurantImage ||
      targetOrder.restaurant?.profileImage ||
      targetOrder.restaurant?.logo;
    if (!img) return "";
    if (typeof img === "string") return img;
    if (typeof img === "object") return img.url || img.secure_url || "";
    return "";
  })();

  const statusText = (() => {
    if (isRatingPrompt) return "Rate restaurant & delivery";
    const s = String(orderStatus);
    const p = String(orderPhase);

    if (s === "confirmed") return "Order confirmed";
    if (s === "preparing" || s === "created" || s === "pending") return "Preparing your order";
    if (s === "ready_for_pickup") return "Ready for pickup";

    if (s === "reached_pickup" || p === "at_pickup") return "Delivery partner reached restaurant";
    if (s === "picked_up" || p === "en_route_to_delivery") return "On the way";
    if (s === "reached_drop" || p === "at_drop") return "Arrived near you";

    if (s === "delivered" || p === "delivered" || p === "completed") return "Delivered";
    return "Preparing your order";
  })();

  const themeColor = "var(--module-theme-color, #EB590E)";
  const themeRgb = "var(--module-theme-rgb, 235,89,14)";
  const cardShadow = "0 8px 30px rgba(var(--module-theme-rgb, 235,89,14), 0.18)";

  const handleDismiss = (e) => {
    e.stopPropagation();
    if (currentOrderKey) {
      localStorage.setItem("dismissed_rating_" + currentOrderKey, "true");
      localStorage.setItem("dismissed_card_" + currentOrderKey, "true");
    }
    setDismissedKey(currentOrderKey);
  };

  const handleCardClick = () => {
    if (isRatingPrompt) {
      navigate(`/food/user/orders?openRating=${encodeURIComponent(currentOrderKey)}`);
    } else {
      navigate(`/food/user/orders/${currentOrderKey}`);
    }
  };

  const displayOrderId = (() => {
    const raw =
      targetOrder.orderId ||
      targetOrder.customOrderId ||
      targetOrder.displayOrderId ||
      (typeof targetOrder.id === "string" && targetOrder.id.startsWith("FOD-") ? targetOrder.id : null);
    if (raw) return raw.startsWith("#") ? raw : `#${raw}`;
    const fallback = targetOrder.id || targetOrder._id;
    if (!fallback) return "";
    const str = String(fallback);
    return str.startsWith("FOD-") ? `#${str}` : `#${str.slice(-6).toUpperCase()}`;
  })();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`fixed ${hasBottomNav ? "bottom-20" : "bottom-6"} left-4 right-4 z-[9999]`}
      >
        <div 
          onClick={handleCardClick}
          className="relative bg-white/95 backdrop-blur-xl rounded-[20px] p-4 border overflow-visible cursor-pointer group"
          style={{
            boxShadow: cardShadow,
            borderColor: "rgba(var(--module-theme-rgb, 235,89,14), 0.22)",
          }}
        >
          {/* Subtle gradient background mesh */}
          <div
            className="absolute inset-0 opacity-60 pointer-events-none rounded-[20px]"
            style={{
              background: "linear-gradient(to right, rgba(var(--module-theme-rgb, 235,89,14), 0.12), rgba(255,255,255,0.40), rgba(255,255,255,0.85))",
            }}
          />
          
          <button 
             onClick={handleDismiss}
             className="absolute top-2 right-2 p-1.5 rounded-full transition-colors z-20 shadow-sm"
             style={{
               backgroundColor: "rgba(var(--module-theme-rgb, 235,89,14), 0.20)",
               color: "var(--module-theme-color, #EB590E)",
               border: "1px solid rgba(var(--module-theme-rgb, 235,89,14), 0.32)",
             }}
          >
            <X className="w-3.5 h-3.5 pointer-events-none" />
          </button>

          <div className="flex items-center gap-4 relative z-10 w-full">
            {restaurantImage ? (
              <div className="w-12 h-12 rounded-xl border border-gray-100 overflow-hidden shadow-sm shrink-0 bg-white flex items-center justify-center relative">
                <img 
                  src={restaurantImage} 
                  alt={restaurantName} 
                  className="w-full h-full object-cover" 
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                {isRatingPrompt && (
                  <div className="absolute -bottom-1 -right-1 rounded-full p-0.5 shadow-sm border border-white" style={{ backgroundColor: themeColor }}>
                    <Star className="w-3 h-3 text-white fill-white" />
                  </div>
                )}
              </div>
            ) : isRatingPrompt ? (
              <div className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: "rgba(var(--module-theme-rgb, 235,89,14), 0.08)", borderColor: "rgba(var(--module-theme-rgb, 235,89,14), 0.2)" }}>
                <Star className="w-6 h-6 fill-current" style={{ color: themeColor }} />
              </div>
            ) : (
              <CookingAnimation />
            )}

            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-2 max-w-full">
                <p className="text-gray-900 font-bold text-base md:text-lg truncate tracking-tight">{restaurantName}</p>
                {displayOrderId && (
                  <span className="text-[10px] font-black tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-zinc-800 border border-gray-200/60 dark:border-zinc-700/60 px-2 py-0.5 rounded-full shrink-0">
                    {displayOrderId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="font-bold text-xs md:text-sm truncate" style={{ color: isRatingPrompt ? themeColor : "#6B7280" }}>
                  {statusText}
                </p>
                <ChevronRight className="w-4 h-4 shrink-0 group-hover:translate-x-1 transition-transform" style={{ color: themeColor }} />
              </div>
            </div>

            {!isRatingPrompt && (
              <div
                className="shadow-lg rounded-xl px-4 py-2 shrink-0 flex flex-col items-center justify-center border"
                style={{
                  background: `linear-gradient(135deg, ${themeColor}, rgba(${themeRgb}, 0.84))`,
                  boxShadow: "0 10px 18px rgba(var(--module-theme-rgb, 235,89,14), 0.25)",
                  borderColor: "rgba(var(--module-theme-rgb, 235,89,14), 0.35)",
                }}
              >
                <p className="text-orange-50 text-[10px] font-bold uppercase tracking-wider opacity-95 leading-tight mb-[2px]">
                  arriving in
                </p>
                <p className="text-white text-base md:text-[17px] font-black leading-tight drop-shadow-sm">
                  {timeRemaining !== null
                    ? `${Math.max(1, timeRemaining)} min`
                    : "--"}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

const OrderTrackingCard = memo(OrderTrackingCardInner);
export default OrderTrackingCard;
