import mongoose from 'mongoose';
import { logger } from '../../../../utils/logger.js';
import {
  sendNotificationToOwner,
  sendNotificationToOwners,
  notifyAdminsSafely,
} from "../../../../core/notifications/firebase.service.js";
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';

export function enqueueOrderEvent(action, payload = {}) {
  try {
    void addOrderJob({ action, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  const dv = o.deliveryVerification;
  if (dv && dv.dropOtp != null) {
    const d = dv.dropOtp;
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  o.acceptedDeliveryPartnerId = o.dispatch?.deliveryPartnerId
    ? String(o.dispatch.deliveryPartnerId?._id || o.dispatch.deliveryPartnerId)
    : null;
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId;
  o.riderEarning = Number(o.riderEarning ?? 0) || 0;
  o.earnings = o.riderEarning;
  return o;
}

export function emitDeliveryDropOtpToUser(order, plainOtp) {
  try {
    const io = getIO();
    if (!io || !plainOtp || !order?.userId) return;
    io.to(rooms.user(order.userId)).emit("delivery_drop_otp", {
      orderMongoId: order._id?.toString?.(),
      orderId: order.order_id || order._id?.toString?.(),
      otp: plainOtp,
      message:
        "Share this OTP with your delivery partner to hand over the order.",
    });
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };
  
  // Search BOTH underscore and camelCase variants for robust lookup
  return {
    $or: [
        { order_id: raw },
        { orderId: raw }
    ]
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  const statusHistory = Array.isArray(order?.statusHistory)
    ? order.statusHistory
    : [];
  const cancellationEntry = [...statusHistory]
    .reverse()
    .find((entry) => String(entry?.to || "").toLowerCase().includes("cancel"));
  const cancellationReason =
    String(order?.cancellationReason || "").trim() ||
    String(cancellationEntry?.note || "").trim() ||
    (String(order?.orderStatus || "").toLowerCase().includes("cancel")
      ? String(order?.note || "").trim()
      : "");
  const cancellationStatus = String(cancellationEntry?.to || "").toLowerCase();
  let cancelledBy = "";
  if (cancellationStatus === "cancelled_by_user") cancelledBy = "customer";
  else if (cancellationStatus === "cancelled_by_restaurant")
    cancelledBy = "restaurant";
  else if (cancellationStatus === "cancelled_by_admin") cancelledBy = "admin";
  else if (String(cancellationEntry?.byRole || "").toUpperCase() === "USER")
    cancelledBy = "customer";
  else if (
    String(cancellationEntry?.byRole || "").toUpperCase() === "RESTAURANT"
  )
    cancelledBy = "restaurant";
  else if (String(cancellationEntry?.byRole || "").toUpperCase() === "ADMIN")
    cancelledBy = "admin";

  const deliveryPartner =
    order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null;
  const deliveryPartnerName =
    deliveryPartner && typeof deliveryPartner === "object"
      ? deliveryPartner.name || deliveryPartner.fullName || ""
      : "";
  const deliveryPartnerPhone =
    deliveryPartner && typeof deliveryPartner === "object"
      ? deliveryPartner.phone || deliveryPartner.phoneNumber || deliveryPartner.mobile || ""
      : "";

  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    status: order?.orderStatus || order?.status || "",
    cancellationReason,
    cancelledBy,
    cancelledAt: cancellationEntry?.at || null,
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId: deliveryPartner,
    deliveryPartnerName,
    deliveryPartnerPhone,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0]
      } : (order?.deliveryState?.currentLocation || null)
    }
  };
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || {};
  const deliveryAddress = order?.deliveryAddress || {};
  const customerAddressParts = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  console.log(`[DEBUG] buildDeliverySocketPayload - Order: ${order?.orderId || order?._id}`);
  console.log(`[DEBUG] buildDeliverySocketPayload - riderEarning in doc: ${order?.riderEarning}`);
  console.log(`[DEBUG] buildDeliverySocketPayload - deliveryFee in doc: ${order?.pricing?.deliveryFee}`);

  return {
    orderMongoId:
      orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id,
    orderId: order?.order_id || order?._id?.toString?.(),
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName: restaurant?.restaurantName || order?.restaurantName,
    restaurantAddress:
      restaurantLocation?.address ||
      restaurantLocation?.formattedAddress ||
      restaurant?.addressLine1 ||
      "",
    restaurantPhone: restaurant?.phone || "",
    restaurantLocation: {
      coordinates: Array.isArray(restaurantLocation?.coordinates)
        ? restaurantLocation.coordinates
        : undefined,
      latitude: restaurantLocation?.latitude,
      lat: restaurantLocation?.latitude ?? restaurantLocation?.lat,
      longitude: restaurantLocation?.longitude,
      lng: restaurantLocation?.longitude ?? restaurantLocation?.lng,
      address:
        restaurantLocation?.address ||
        restaurantLocation?.formattedAddress ||
        restaurant?.addressLine1 ||
        "",
      area: restaurantLocation?.area || restaurant?.area || "",
      city: restaurantLocation?.city || restaurant?.city || "",
      state: restaurantLocation?.state || restaurant?.state || "",
    },
    deliveryAddress: order?.deliveryAddress,
    customerAddress: customerAddressParts.length ? customerAddressParts.join(', ') : "",
    customerName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    customerPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    userName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    userPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    note: order?.note || "",
    riderEarning: order?.riderEarning ?? 0,
    earnings: order?.riderEarning ?? 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    estimatedDeliveryTime: order?.estimatedDeliveryTime || 30,
    prepTime: order?.estimatedDeliveryTime || 30,
    statusHistory: (order?.statusHistory || []).map(h => {
      const plain = h?.toObject ? h.toObject() : { ...(h || {}) };
      return {
        ...plain,
        at: plain.at instanceof Date ? plain.at.toISOString() : (plain.at ? new Date(plain.at).toISOString() : undefined)
      };
    }),
    createdAt: order?.createdAt instanceof Date ? order.createdAt.toISOString() : (order?.createdAt ? new Date(order.createdAt).toISOString() : undefined),
    updatedAt: order?.updatedAt instanceof Date ? order.updatedAt.toISOString() : (order?.updatedAt ? new Date(order.updatedAt).toISOString() : undefined),
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  if (String(orderLike?.orderStatus || "").toLowerCase() === "pending_payment") return false;
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  if (["cash", "wallet"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

export async function notifyRestaurantNewOrder(orderDoc) {
  try {
    if (!orderDoc) return;

    const io = getIO();
    const payload = {
      ...orderDoc.toObject(),
      orderMongoId: orderDoc._id?.toString?.() || undefined,
      orderId: orderDoc.order_id || orderDoc._id?.toString?.(),
    };
    const canExposeToRestaurant = canExposeOrderToRestaurant(orderDoc);

    if (io && canExposeToRestaurant) {
      logger.info("[RestaurantOrders] Emitting new_order to " + rooms.restaurant(orderDoc.restaurantId) + " for order " + (orderDoc._id?.toString?.() || ""));
      io.to(rooms.restaurant(orderDoc.restaurantId)).emit("new_order", payload);
      io.to("admin:orders").emit("admin_new_order", {
        ...payload,
        source: "restaurant_order",
      });
    }

    if (io) {
      io.to("admin:orders").emit("admin_notification", {
        id: String(orderDoc._id),
        title: "New order received",
        message: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
        link: `/admin/food/orders/all?orderId=${orderDoc._id?.toString?.() || ""}`,
        targetType: "ADMIN",
        createdAt: new Date().toISOString(),
      });
    }

    if (canExposeToRestaurant) {
      await notifyOwnersSafely(
        [{ ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId }],
        {
          title: "New order received",
          body: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
          data: {
            type: "new_order",
            orderId: orderDoc._id.toString(),
            orderMongoId: orderDoc._id?.toString?.() || "",
            link: `/restaurant/orders/${orderDoc._id?.toString?.() || ""}`,
          },
        },
      );
    }

    await notifyAdminsSafely({
      title: "New order received",
      body: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
      data: {
        type: "admin_new_order",
        orderId: String(orderDoc._id),
        orderMongoId: String(orderDoc._id),
        link: `/admin/food/orders/all?orderId=${orderDoc._id?.toString?.() || ""}`,
      },
    });
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}
export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}

export async function checkRestaurantOpenStatus(restaurantId, checkDate = new Date()) {
  const { FoodRestaurant } = await import('../../restaurant/models/restaurant.model.js');
  const restaurant = await FoodRestaurant.findById(restaurantId)
    .select('status isAcceptingOrders openingTime closingTime openDays')
    .lean();

  if (!restaurant) {
    return { isOpen: false, reason: 'Restaurant not found' };
  }

  if (restaurant.status !== 'approved') {
    return { isOpen: false, reason: 'Restaurant not accepting orders' };
  }

  if (restaurant.isAcceptingOrders === false) {
    return { isOpen: false, reason: 'Restaurant is currently offline' };
  }

  // Check outlet timings collection for granular day timing
  const { FoodRestaurantOutletTimings } = await import('../../restaurant/models/outletTimings.model.js');
  const timingDoc = await FoodRestaurantOutletTimings.findOne({ restaurantId }).lean();

  // Standardize time check to IST timezone (Asia/Kolkata)
  let istDate;
  try {
    const istString = checkDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    istDate = new Date(istString);
  } catch (e) {
    istDate = checkDate;
  }

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDayName = daysOfWeek[istDate.getDay()];

  let openingTime = restaurant.openingTime || null;
  let closingTime = restaurant.closingTime || null;

  if (timingDoc && Array.isArray(timingDoc.timings)) {
    const timing = timingDoc.timings.find((t) => t && String(t.day).toLowerCase() === currentDayName.toLowerCase());
    if (timing) {
      if (timing.isOpen === false) {
        return { isOpen: false, reason: 'Restaurant is closed today' };
      }
      openingTime = timing.openingTime || openingTime;
      closingTime = timing.closingTime || closingTime;
    }
  } else if (Array.isArray(restaurant.openDays) && restaurant.openDays.length > 0) {
    const openDaysNormalized = restaurant.openDays.map(d => String(d).trim().toLowerCase());
    if (!openDaysNormalized.includes(currentDayName.toLowerCase())) {
      return { isOpen: false, reason: 'Restaurant is closed today' };
    }
  }

  if (!openingTime || !closingTime) {
    // Default to open if no timing set
    return { isOpen: true };
  }

  const parseTimeToMinutes = (timeStr) => {
    const parts = String(timeStr || '').trim().split(':');
    if (parts.length !== 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  };

  const openMin = parseTimeToMinutes(openingTime);
  const closeMin = parseTimeToMinutes(closingTime);

  if (openMin === null || closeMin === null) {
    return { isOpen: true };
  }

  const currentMin = istDate.getHours() * 60 + istDate.getMinutes();

  let isWithin = false;
  if (closeMin < openMin) {
    // Overnight operational window (e.g., 18:00 to 02:00 next day)
    isWithin = currentMin >= openMin || currentMin <= closeMin;
  } else {
    // Normal same-day window (e.g., 09:00 to 22:00)
    isWithin = currentMin >= openMin && currentMin <= closeMin;
  }

  if (!isWithin) {
    return { isOpen: false, reason: `Restaurant is closed now. Operational hours: ${openingTime} to ${closingTime}` };
  }

  return { isOpen: true };
}

export function isCodOrder(order) {
  if (!order) return false;
  const pm = String(
    order.paymentMethod ||
      order.paymentMode ||
      order.payment?.method ||
      order.payment?.paymentMode ||
      '',
  ).toLowerCase();
  return pm === 'cod' || pm === 'cash' || pm === 'cash_on_delivery';
}

export function extractOrderPayableAmount(order) {
  if (!order) return 0;
  return Number(
    order.pricing?.payableAmount ??
      order.amounts?.payableAmount ??
      order.payableAmount ??
      order.totalAmount ??
      0,
  );
}
