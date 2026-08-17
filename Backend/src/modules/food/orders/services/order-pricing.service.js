import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm, checkRestaurantOpenStatus } from './order.helpers.js';
import { calculateCouponDiscount, getCouponIneligibilityReason } from './couponValidation.service.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import { createTtlCache } from '../../../../utils/cache.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const feeSettingsCache = createTtlCache({ ttlMs: 30_000, maxEntries: 4, name: 'fee-settings' });

/** Called after an admin saves fee settings so the next request reloads them. */
export function invalidateFeeSettingsCache() {
  feeSettingsCache.clear();
}

function toPoint(entity) {
  if (!entity || typeof entity !== 'object') return null;

  const queue = [entity];
  const visited = new Set();
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source || typeof source !== 'object' || visited.has(source)) continue;
    visited.add(source);

    if (Array.isArray(source.coordinates) && source.coordinates.length >= 2) {
      const [lng, lat] = source.coordinates;
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        return { lat: Number(lat), lng: Number(lng) };
      }
    }

    const lat = Number(source.latitude ?? source.lat);
    const lng = Number(source.longitude ?? source.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    if (source.location && typeof source.location === 'object') {
      queue.push(source.location);
    }
  }

  return null;
}

export async function getDeliveryDistanceDetails(restaurant, deliveryAddress) {
  const restaurantPoint = toPoint(restaurant);
  const customerPoint = toPoint(deliveryAddress);

  let straightLineDistanceKm = null;
  if (restaurantPoint && customerPoint) {
    const straightLine = haversineKm(
      restaurantPoint.lat,
      restaurantPoint.lng,
      customerPoint.lat,
      customerPoint.lng,
    );
    if (Number.isFinite(straightLine)) {
      straightLineDistanceKm = Number(straightLine.toFixed(2));
    }
  }

  if (!restaurantPoint || !customerPoint) {
    return {
      distanceKm: straightLineDistanceKm,
      roadDistanceKm: straightLineDistanceKm,
      straightLineDistanceKm,
      roadDurationMins: null,
    };
  }

  try {
    const route = await fetchDrivingRoute(restaurantPoint, customerPoint);
    const routeDistanceKm = Number(route?.distanceKm);
    if (Number.isFinite(routeDistanceKm) && routeDistanceKm > 0) {
      return {
        distanceKm: Number(routeDistanceKm.toFixed(2)),
        roadDistanceKm: Number(routeDistanceKm.toFixed(2)),
        straightLineDistanceKm,
        roadDurationMins: Number.isFinite(Number(route?.durationSeconds))
          ? Math.max(1, Math.ceil(Number(route.durationSeconds) / 60))
          : null,
      };
    }
  } catch {
    // Fall through to straight-line distance.
  }

  return {
    distanceKm: straightLineDistanceKm,
    roadDistanceKm: straightLineDistanceKm,
    straightLineDistanceKm,
    roadDurationMins: null,
  };
}

export async function calculateOrderPricing(userId, dto) {
  // Select the operating-hours fields too so checkRestaurantOpenStatus can reuse
  // this document instead of issuing a second query for the same restaurant.
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status location isAcceptingOrders openingTime closingTime openDays")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  const checkTime = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
  const openStatus = await checkRestaurantOpenStatus(dto.restaurantId, checkTime, { restaurant });
  if (!openStatus.isOpen) {
    throw new ValidationError(openStatus.reason || "Restaurant is closed at the selected time");
  }

  const items = Array.isArray(dto.items) ? dto.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
    0,
  );

  // Fee settings are a single admin-managed document read on every cart
  // recalculation; a short TTL removes that query from the hot path.
  const feeDoc = await feeSettingsCache.get('current', () =>
    FoodFeeSettings.findOne().sort({ createdAt: -1 }).lean().then((doc) => doc ?? null),
  );
  const feeSettings = feeDoc || {
    deliveryFee: 0,
    deliveryFeeRanges: [],
    freeDeliveryThreshold: null,
    platformFee: 0,
    gstRate: 0,
  };

  const packagingFee = 0;
  const platformFee = Number(feeSettings.platformFee || 0);

  const freeThreshold = Number(feeSettings.freeDeliveryThreshold || 0);
  let deliveryFee = 0;
  let distanceKm = null;
  let roadDistanceKm = null;
  let straightLineDistanceKm = null;
  let roadDurationMins = null;
  if (
    Number.isFinite(freeThreshold) &&
    freeThreshold > 0 &&
    subtotal >= freeThreshold
  ) {
    deliveryFee = 0;
  } else {
    const distanceDetails = await getDeliveryDistanceDetails(
      restaurant,
      dto.deliveryAddress,
    );
    distanceKm = distanceDetails.distanceKm;
    roadDistanceKm = distanceDetails.roadDistanceKm;
    straightLineDistanceKm = distanceDetails.straightLineDistanceKm;
    roadDurationMins = distanceDetails.roadDurationMins;

    const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
      ? [...feeSettings.deliveryFeeRanges]
      : [];
    if (ranges.length > 0 && Number.isFinite(distanceKm)) {
      ranges.sort((a, b) => Number(a.min) - Number(b.min));
      let matched = null;
      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i] || {};
        const min = Number(r.min);
        const max = Number(r.max);
        const fee = Number(r.fee);
        if (
          !Number.isFinite(min) ||
          !Number.isFinite(max) ||
          !Number.isFinite(fee)
        ) {
          continue;
        }
        const isLast = i === ranges.length - 1;
        const inRange = isLast
          ? distanceKm >= min && distanceKm <= max
          : distanceKm >= min && distanceKm < max;
        if (inRange) {
          matched = fee;
          break;
        }
      }
      deliveryFee = Number.isFinite(matched)
        ? matched
        : Number(feeSettings.deliveryFee || 0);
    } else {
      deliveryFee = Number(feeSettings.deliveryFee || 0);
    }
  }

  const gstRate = Number(feeSettings.gstRate || 0);
  const tax =
    Number.isFinite(gstRate) && gstRate > 0
      ? Math.round(subtotal * (gstRate / 100))
      : 0;

  let discount = 0;
  let appliedCoupon = null;
  let couponError = null;
  const codeRaw = dto.couponCode
    ? String(dto.couponCode).trim().toUpperCase()
    : "";

  if (codeRaw) {
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (!offer) {
      couponError = "Invalid coupon code";
    } else {
      const ineligibilityReason = await getCouponIneligibilityReason({
        offer,
        userId,
        restaurantId: dto.restaurantId,
        subtotal,
      });
      if (!ineligibilityReason) {
        discount = calculateCouponDiscount(offer, subtotal);
        appliedCoupon = { code: codeRaw, discount };
      } else {
        const errorMap = {
          not_found: "Invalid coupon code",
          inactive: "Coupon is currently inactive",
          not_started: "Coupon offer has not started yet",
          expired: "Coupon offer has expired",
          restaurant_mismatch: "Coupon is not valid for this restaurant",
          user_not_targeted: "This coupon is not available for your account",
          min_order_not_met: `Minimum order value of ₹${offer.minOrderValue || 0} not met`,
          global_limit_reached: "Coupon usage limit has been reached",
          per_user_limit_reached: "You have already used this coupon",
          pending_order_exists: "First-time coupon is not valid as you currently have an active/pending order",
          delivered_order_exists: "First-time coupon is only valid for your very first order",
          user_cancelled_order_exists: "First-time coupon is not applicable as your previous order was cancelled by you"
        };
        couponError = errorMap[ineligibilityReason] || "Coupon is not applicable";
      }
    }
  }

  const total = Math.max(
    0,
    subtotal + packagingFee + deliveryFee + platformFee + tax - discount,
  );

  return {
    pricing: {
      subtotal,
      tax,
      packagingFee,
      deliveryFee,
      platformFee,
      discount,
      total,
      currency: "INR",
      couponCode: appliedCoupon?.code || codeRaw || null,
      appliedCoupon,
      couponError,
      distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
      roadDistanceKm: Number.isFinite(roadDistanceKm) ? Number(roadDistanceKm.toFixed(2)) : null,
      straightLineDistanceKm: Number.isFinite(straightLineDistanceKm)
        ? Number(straightLineDistanceKm.toFixed(2))
        : null,
      roadDurationMins: Number.isFinite(Number(roadDurationMins))
        ? Math.ceil(Number(roadDurationMins))
        : null,
      deliveryFeeBreakdown: Number.isFinite(distanceKm) ? {
        source: "distance",
        distanceKm: Number(distanceKm.toFixed(2)),
        roadDistanceKm: Number.isFinite(roadDistanceKm) ? Number(roadDistanceKm.toFixed(2)) : null,
        deliveryFee,
      } : { source: "default", deliveryFee },
    },
  };
}
