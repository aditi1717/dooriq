import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, MapPin, FastForward, Clock, Phone, ChefHat, ChevronDown } from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { getHaversineDistance, calculateETA } from '@/modules/DeliveryV2/utils/geo';

/**
 * NewOrderModal - Ported to Original 1:1 Theme with Slider Accept.
 * Matches the Zomato/Swiggy style Green Header + White Card.
 */
export const NewOrderModal = ({ order, onAccept, onReject, onMinimize, acceptDisabled = false }) => {
  const { riderLocation } = useDeliveryStore();

  const getLocationPoint = (source, fallbackLatKeys = [], fallbackLngKeys = []) => {
    if (!source) return null;

    if (source.location) {
      const nested = getLocationPoint(source.location, fallbackLatKeys, fallbackLngKeys);
      if (nested) return nested;
    }

    if (Array.isArray(source.coordinates) && source.coordinates.length >= 2) {
      const [lng, lat] = source.coordinates;
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        return { lat: Number(lat), lng: Number(lng) };
      }
    }

    const latCandidates = ['latitude', 'lat', ...fallbackLatKeys];
    const lngCandidates = ['longitude', 'lng', ...fallbackLngKeys];

    for (const latKey of latCandidates) {
      if (source?.[latKey] == null) continue;
      const lat = Number(source[latKey]);
      if (!Number.isFinite(lat)) continue;

      for (const lngKey of lngCandidates) {
        if (source?.[lngKey] == null) continue;
        const lng = Number(source[lngKey]);
        if (Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
    }

    return null;
  };

  const formatDistanceLabel = (valueKm) => {
    if (!Number.isFinite(valueKm) || valueKm < 0) return '--';
    if (valueKm < 1) return `${Math.round(valueKm * 1000)} M`;
    return `${valueKm.toFixed(1)} KM`;
  };

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

  const [timeLeft, setTimeLeft] = useState(() => {
    const partnerId = getStoredDeliveryPartnerId();
    if (!partnerId || !order?.dispatch?.offeredTo) return 30;
    
    const offer = order.dispatch.offeredTo.find(
      (o) => String(o.partnerId?._id || o.partnerId) === String(partnerId)
    );
    if (!offer || !offer.at) return 30;

    const elapsed = Math.floor((Date.now() - new Date(offer.at).getTime()) / 1000);
    return Math.max(0, 30 - elapsed);
  });

  useEffect(() => {
    if (timeLeft <= 0) {
      onReject?.('timeout');
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, onReject]);

  const { pickupDistanceKm, deliveryDistanceKm, etaMins } = useMemo(() => {
    if (!order) {
      return {
        pickupDistanceKm: null,
        deliveryDistanceKm: null,
        etaMins: null,
      };
    }

    const restaurantPoint =
      getLocationPoint(order.restaurantLocation) ||
      getLocationPoint(order.restaurantId, ['restaurant_lat', 'restaurantLat'], ['restaurant_lng', 'restaurantLng']) ||
      getLocationPoint(order, ['restaurant_lat', 'restaurantLat'], ['restaurant_lng', 'restaurantLng']);

    const customerPoint =
      getLocationPoint(order.customerLocation) ||
      getLocationPoint(order.deliveryLocation) ||
      getLocationPoint(order.deliveryAddress) ||
      getLocationPoint(order, ['customer_lat', 'customerLat'], ['customer_lng', 'customerLng']);

    let deliveryDistKm = null;
    if (restaurantPoint && customerPoint) {
      const distM = getHaversineDistance(
        restaurantPoint.lat,
        restaurantPoint.lng,
        customerPoint.lat,
        customerPoint.lng,
      );
      deliveryDistKm = Number.isFinite(distM) ? distM / 1000 : null;
    }

    let pickupDistKm = null;
    const backendPickupDistance = Number(order.pickupDistanceKm);
    if (Number.isFinite(backendPickupDistance) && backendPickupDistance >= 0 && backendPickupDistance < 100) {
      pickupDistKm = backendPickupDistance;
    } else {
      const riderPoint = getLocationPoint(riderLocation);
      if (riderPoint && restaurantPoint) {
        const distM = getHaversineDistance(
          riderPoint.lat,
          riderPoint.lng,
          restaurantPoint.lat,
          restaurantPoint.lng,
        );
        pickupDistKm = Number.isFinite(distM) ? distM / 1000 : null;
      }
    }

    // 6. Calculate prep time
    const basePrepTime = Number(order.estimatedDeliveryTime || order.prepTime || 15) || 15;
    const getPreparingTimestamp = (order) => {
      const history = order.statusHistory || [];
      const preparingEntry = history.find(h => h.to === 'preparing' || h.to === 'confirmed');
      if (preparingEntry && preparingEntry.at) {
        const d = new Date(preparingEntry.at);
        if (!isNaN(d.getTime())) return d;
      }
      if (order.createdAt) {
        const d = new Date(order.createdAt);
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };
    const prepStart = getPreparingTimestamp(order);
    const elapsedMs = (prepStart && !isNaN(prepStart.getTime())) ? Math.max(0, Date.now() - prepStart.getTime()) : 0;
    const remainingSeconds = Math.max(0, basePrepTime * 60 - Math.floor(elapsedMs / 1000));
    
    let etaDisplay = "";
    if (remainingSeconds <= 0) {
      etaDisplay = "0 MINS";
    } else if (remainingSeconds <= 60) {
      etaDisplay = `${remainingSeconds} SECS`;
    } else {
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      etaDisplay = `${mins} MIN ${secs} SEC`;
    }

    return {
      pickupDistanceKm: pickupDistKm,
      deliveryDistanceKm: deliveryDistKm,
      etaMins: etaDisplay,
    };
  }, [order, riderLocation, timeLeft]);

  if (!order) return null;

  const earnings = Number(order.riderEarning ?? 0) || 0;
  const restaurantName =
    order.restaurantName ||
    order.restaurant_name ||
    order.restaurant?.restaurantName ||
    order.restaurant?.name ||
    order.restaurantId?.restaurantName ||
    order.restaurantId?.name ||
    'Restaurant';
  const restaurantAddress = order.restaurantAddress || order.restaurant_address || (order.restaurantId?.location?.address) || 'Address not available';
  const deliveryAddress = order?.deliveryAddress || {};

  const customerLocation =
    getLocationPoint(order.customerLocation) ||
    getLocationPoint(order.deliveryLocation) ||
    getLocationPoint(order.deliveryAddress) ||
    getLocationPoint(order, ['customer_lat', 'customerLat'], ['customer_lng', 'customerLng']);

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
    order.customerAddress ||
    order.customer_address ||
    (addressPartsFromSchema.length ? addressPartsFromSchema.join(', ') : '') ||
    (customerLocation?.lat != null && customerLocation?.lng != null
      ? `Lat ${Number(customerLocation.lat).toFixed(5)}, Lng ${Number(customerLocation.lng).toFixed(5)}`
      : 'Location not available');

  const mapsLink =
    customerLocation?.lat != null && customerLocation?.lng != null
      ? `https://www.google.com/maps?q=${encodeURIComponent(
          `${customerLocation.lat},${customerLocation.lng}`,
        )}`
      : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center"
    >
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full max-w-lg bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] relative overflow-hidden"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center py-3 bg-white relative z-20">
          <button 
            onClick={onMinimize} 
            className="w-12 h-1.5 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors active:scale-95"
            aria-label="Minimize"
          />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Header Ribbon (Compact Premium) */}
          <div
            className="px-6 py-5 flex justify-between items-center text-white"
            style={{
              backgroundColor: "var(--module-theme-color, #00B761)",
              borderBottom: "1px solid rgba(var(--module-theme-rgb, 0,183,97), 0.25)",
            }}
          >
            <div>
              <p className="text-white/80 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
                New Order <span className="opacity-50 mx-1">•</span> #{order?.shortId || order?.orderId || order?._id?.slice(-6) || 'N/A'}
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold opacity-80">₹</span>
                <h2 className="text-4xl font-black tracking-tighter">{Number(earnings || 0).toFixed(2)}</h2>
              </div>
            </div>
            <div className="bg-black/15 border border-white/20 rounded-2xl px-4 py-2 text-white flex flex-col items-center min-w-[80px]">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Expires</span>
              <span className="font-black text-2xl tabular-nums leading-none">{timeLeft}s</span>
            </div>
          </div>

          <div className="px-6 py-4 space-y-5">
            {/* Direct Summary Metrics (Horizontal Compact Row) */}
            <div className="flex gap-2">
               <div className="flex-1 p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-3">
                 <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-emerald-500">
                    <Clock className="w-5 h-5" />
                 </div>
                 <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">EST. Time</span>
                    <span className="text-sm font-black text-gray-900 tracking-tight leading-none">{etaMins}</span>
                 </div>
               </div>
               <div className="flex-1 p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-3">
                 <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-blue-500">
                    <MapPin className="w-5 h-5" />
                 </div>
                 <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Distance</span>
                    <span className="text-sm font-black text-gray-900 tracking-tight leading-none">{formatDistanceLabel(deliveryDistanceKm)}</span>
                 </div>
               </div>
            </div>

            {/* Delivery Locations (Tighter Timeline) */}
            <div className="bg-gray-50/50 rounded-3xl p-5 border border-gray-100/50">
              <div className="flex gap-4 relative">
                <div className="flex flex-col items-center py-1">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20" />
                  <div className="flex-1 w-0.5 border-l-2 border-dashed border-gray-200 my-1" />
                  <div className="w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/20" />
                </div>
                
                <div className="flex-1 space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-0.5">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-600">Restaurant Pickup</h4>
                      <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">
                        You -&gt; Restaurant {formatDistanceLabel(pickupDistanceKm)}
                      </span>
                    </div>
                    <h3 className="text-gray-950 font-black text-lg leading-tight mb-0.5">{restaurantName}</h3>
                    <p className="text-gray-500 text-[11px] font-bold leading-normal">{restaurantAddress}</p>
                  </div>

                  <div className="pt-1">
                    <div className="flex items-center justify-between">
                       <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-600 mb-0.5">Customer Drop</h4>
                       <span className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-1">
                        Restaurant -&gt; Customer {formatDistanceLabel(deliveryDistanceKm)}
                       </span>
                    </div>
                    <h3 className="text-gray-950 font-black text-lg leading-tight mb-0.5">Delivery Location</h3>
                    <p className="text-gray-500 text-[11px] font-bold leading-normal">{customerAddress}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Items Summary Section with Variants */}
            {Array.isArray(order.items || order.orderItems || order.cartItems) && (order.items || order.orderItems || order.cartItems).length > 0 && (
              <div className="bg-gray-50/80 rounded-3xl p-4 border border-gray-100 mt-3">
                <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-500 mb-2">Order Items</h4>
                <div className="space-y-1.5">
                  {(order.items || order.orderItems || order.cartItems).map((item, idx) => {
                    const name = item.name || item.foodName || item.title || "Item";
                    const variant = item.variantName || item.variantTitle || item.selectedVariantName || item.selectedVariant?.name || (typeof item.variant === "string" ? item.variant : item.variant?.name) || item.size || "";
                    const displayName = variant ? `${name} (${variant})` : name;
                    return (
                      <div key={idx} className="flex justify-between items-center text-xs font-bold text-gray-800">
                        <span>{item.quantity || item.qty || 1} x {displayName}</span>
                        {item.price != null && <span className="text-gray-500">₹{Number(item.price * (item.quantity || 1)).toFixed(0)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Area (Fixed / Non-Scrolling Footer) */}
        <div className="px-6 pb-8 pt-2 space-y-4 bg-white">
          <ActionSlider 
            label="Slide to Accept" 
            onConfirm={() => onAccept(order)} 
            disabled={acceptDisabled}
            color="bg-emerald-600"
            successLabel="Order Accepted ✓"
          />

          <button 
            onClick={() => onReject?.('rejected')}
            className="w-full text-gray-400 font-black text-[11px] uppercase tracking-[0.2em] hover:text-red-500 transition-colors active:scale-95 py-2"
          >
            Pass this task
          </button>
        </div>
      </motion.div>
    </motion.div>

  );
};
