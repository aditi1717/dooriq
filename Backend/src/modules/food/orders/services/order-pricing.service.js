import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm } from './order.helpers.js';

export async function calculateOrderPricing(userId, dto) {
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status location")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

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
  const codeRaw = dto.couponCode
    ? String(dto.couponCode).trim().toUpperCase()
    : "";

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (offer) {
      const offerEnd = offer.endDate ? new Date(offer.endDate) : null;
      if (offerEnd && offerEnd.getHours() === 0 && offerEnd.getMinutes() === 0) {
        offerEnd.setHours(23, 59, 59, 999);
      }
      const endOk = !offerEnd || now <= offerEnd;
      const startOk = !offer.startDate || now >= new Date(offer.startDate);
      const statusOk = offer.status === "active" && offer.showInCart !== false;
      const selectedRestaurantIds = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0
        ? offer.restaurantIds
        : [offer.restaurantId].filter(Boolean);
      const scopeOk =
        offer.restaurantScope !== "selected" ||
        selectedRestaurantIds.some((id) => String(id) === String(dto.restaurantId || ""));
      const minOk = subtotal >= (Number(offer.minOrderValue) || 0);
      let usageOk = true;
      if (
        Number(offer.usageLimit) > 0 &&
        Number(offer.usedCount || 0) >= Number(offer.usageLimit)
      ) {
        usageOk = false;
      }

      let perUserOk = true;
      if (userId && mongoose.Types.ObjectId.isValid(userId) && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
          offerId: offer._id,
          userId: new mongoose.Types.ObjectId(userId),
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
          perUserOk = false;
        }
      }

      let firstOrderOk = true;
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        if (offer.customerScope === "first-time") {
          const c = await FoodOrder.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
          });
          firstOrderOk = c === 0;
        }
        if (offer.isFirstOrderOnly === true) {
          const c2 = await FoodOrder.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
          });
          if (c2 > 0) firstOrderOk = false;
        }
      }

      const allowed =
        statusOk &&
        startOk &&
        endOk &&
        scopeOk &&
        minOk &&
        usageOk &&
        perUserOk &&
        firstOrderOk;

      if (allowed) {
        if (offer.discountType === "percentage") {
          const raw = subtotal * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
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
      distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
      deliveryFeeBreakdown: Number.isFinite(distanceKm) ? {
        source: "distance",
        distanceKm: Number(distanceKm.toFixed(2)),
        deliveryFee,
      } : { source: "default", deliveryFee },
    },
  };
}
