import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm, checkRestaurantOpenStatus } from './order.helpers.js';
import { calculateCouponDiscount, getCouponIneligibilityReason } from './couponValidation.service.js';

export async function calculateOrderPricing(userId, dto) {
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status location")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  const checkTime = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
  const openStatus = await checkRestaurantOpenStatus(dto.restaurantId, checkTime);
  if (!openStatus.isOpen) {
    throw new ValidationError(openStatus.reason || "Restaurant is closed at the selected time");
  }

  const items = Array.isArray(dto.items) ? dto.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
    0,
  );

  const feeDoc = await FoodFeeSettings.findOne().sort({ createdAt: -1 }).lean();
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
  if (
    Number.isFinite(freeThreshold) &&
    freeThreshold > 0 &&
    subtotal >= freeThreshold
  ) {
    deliveryFee = 0;
  } else {
    // Calculate distance if coordinates are available
    if (
      restaurant?.location?.coordinates?.length === 2 &&
      dto.deliveryAddress?.location?.coordinates?.length === 2
    ) {
      const [rLng, rLat] = restaurant.location.coordinates;
      const [dLng, dLat] = dto.deliveryAddress.location.coordinates;
      distanceKm = haversineKm(rLat, rLng, dLat, dLng);
    }

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
      deliveryFeeBreakdown: Number.isFinite(distanceKm) ? {
        source: "distance",
        distanceKm: Number(distanceKm.toFixed(2)),
        deliveryFee,
      } : { source: "default", deliveryFee },
    },
  };
}
