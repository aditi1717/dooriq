import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';

const toObjectId = (value) => {
  const raw = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const isOfferActiveForUser = (offer = {}) => {
  if ((offer.status || 'active') !== 'active') return false;
  if (offer.showInCart === false) return false;
  return true;
};

export const calculateCouponDiscount = (offer, subtotal = 0) => {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  if (safeSubtotal <= 0) return 0;

  if (offer?.discountType === 'percentage') {
    const raw = safeSubtotal * ((Number(offer?.discountValue) || 0) / 100);
    const capped = Number(offer?.maxDiscount)
      ? Math.min(raw, Number(offer.maxDiscount))
      : raw;
    return Math.max(0, Math.min(safeSubtotal, Math.floor(capped)));
  }

  return Math.max(
    0,
    Math.min(safeSubtotal, Math.floor(Number(offer?.discountValue) || 0)),
  );
};

export const getCouponIneligibilityReason = async ({
  offer,
  userId = null,
  restaurantId = null,
  subtotal = 0,
}) => {
  if (!offer) return 'not_found';

  if (!isOfferActiveForUser(offer)) return 'inactive';

  const now = new Date();

  if (offer.startDate) {
    const start = new Date(offer.startDate);
    start.setHours(0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || now < start) return 'not_started';
  }

  if (offer.endDate) {
    const end = new Date(offer.endDate);
    end.setHours(23, 59, 59, 999);
    if (Number.isNaN(end.getTime()) || now > end) return 'expired';
  }

  const normalizedRestaurantId = String(restaurantId || '').trim();
  if (offer.restaurantScope === 'selected') {
    const restaurantIds = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0
      ? offer.restaurantIds
      : [offer.restaurantId].filter(Boolean);
    const matchesRestaurant = restaurantIds.some(
      (id) => String(id || '').trim() === normalizedRestaurantId,
    );
    if (!matchesRestaurant) return 'restaurant_mismatch';
  }

  if (Number(subtotal) < Number(offer.minOrderValue || 0)) return 'min_order_not_met';

  if (
    Number(offer.usageLimit) > 0 &&
    Number(offer.usedCount || 0) >= Number(offer.usageLimit)
  ) {
    return 'global_limit_reached';
  }

  const userObjectId = toObjectId(userId);
  if (userObjectId && Number(offer.perUserLimit) > 0) {
    const usage = await FoodOfferUsage.findOne({
      offerId: offer._id,
      userId: userObjectId,
    }).lean();
    const usageCount = Number(usage?.count || 0);
    if (usageCount >= Number(offer.perUserLimit)) {
      return 'per_user_limit_reached';
    }
  }

  if (userObjectId && (offer.customerScope === 'first-time' || offer.isFirstOrderOnly === true)) {
    const pendingOrderCount = await FoodOrder.countDocuments({
      userId: userObjectId,
      orderStatus: {
        $in: [
          'pending_payment',
          'created',
          'confirmed',
          'preparing',
          'ready_for_pickup',
          'reached_pickup',
          'picked_up',
          'reached_drop'
        ]
      }
    });
    if (pendingOrderCount > 0) return 'pending_order_exists';

    const deliveredOrderCount = await FoodOrder.countDocuments({
      userId: userObjectId,
      orderStatus: 'delivered'
    });
    if (deliveredOrderCount > 0) return 'delivered_order_exists';

    const userCancelledCount = await FoodOrder.countDocuments({
      userId: userObjectId,
      orderStatus: 'cancelled_by_user'
    });
    if (userCancelledCount > 0) return 'user_cancelled_order_exists';
  }

  return null;
};
