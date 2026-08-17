import mongoose from 'mongoose';
import { logger } from '../../../../utils/logger.js';
import { createTtlCache } from '../../../../utils/cache.js';
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

/**
 * @param {object} orderDoc
 * @param {{ includeCustomerContact?: boolean }} [options]
 *   Defaults to TRUE because every existing caller is an assigned-rider,
 *   restaurant or customer context where contact is legitimate. Pass false for
 *   any surface a non-assigned rider can reach.
 */
export function sanitizeOrderForExternal(orderDoc, options = {}) {
  const includeCustomerContact = options.includeCustomerContact !== false;
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;

  if (!includeCustomerContact) {
    o.deliveryAddress = redactDeliveryAddress(o.deliveryAddress);
    o.customerName = '';
    o.customerPhone = '';
    if (o.userId && typeof o.userId === 'object') {
      const { name, phone, email, ...safeUser } = o.userId;
      o.userId = safeUser;
    }
  }
  o.customerContactAvailable = includeCustomerContact;
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
  const pricing = order?.pricing && typeof order.pricing === "object"
    ? { ...order.pricing }
    : order?.pricing;
  const roadDistanceRaw = Number(pricing?.roadDistanceKm);
  const distanceRaw = Number(pricing?.distanceKm);
  const straightLineRaw = Number(pricing?.straightLineDistanceKm);
  const preferredDistanceKm =
    Number.isFinite(roadDistanceRaw) && roadDistanceRaw > 0
      ? Number(roadDistanceRaw.toFixed(2))
      : Number.isFinite(distanceRaw) && distanceRaw > 0
        ? Number(distanceRaw.toFixed(2))
        : Number.isFinite(straightLineRaw) && straightLineRaw > 0
          ? Number(straightLineRaw.toFixed(2))
          : null;
  const normalizedPricing = pricing
    ? {
        ...pricing,
        distanceKm: preferredDistanceKm,
        roadDistanceKm: preferredDistanceKm,
        deliveryFeeBreakdown:
          pricing?.deliveryFeeBreakdown && typeof pricing.deliveryFeeBreakdown === "object"
            ? {
                ...pricing.deliveryFeeBreakdown,
                distanceKm:
                  preferredDistanceKm ?? pricing.deliveryFeeBreakdown.distanceKm ?? null,
                roadDistanceKm:
                  preferredDistanceKm ?? pricing.deliveryFeeBreakdown.roadDistanceKm ?? null,
              }
            : pricing?.deliveryFeeBreakdown,
      }
    : pricing;

  return {
    ...order,
    pricing: normalizedPricing,
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

/**
 * Strip customer-identifying fields from a delivery address while keeping
 * everything a rider needs to judge and route the trip (street, area, geo).
 */
function redactDeliveryAddress(deliveryAddress) {
  if (!deliveryAddress || typeof deliveryAddress !== 'object') return deliveryAddress;
  const source = deliveryAddress?.toObject ? deliveryAddress.toObject() : { ...deliveryAddress };
  delete source.phone;
  delete source.name;
  delete source.fullName;
  return source;
}

/**
 * Build the rider-facing order payload.
 *
 * @param {object} orderDoc
 * @param {object|null} restaurantDoc
 * @param {{ includeCustomerContact?: boolean }} [options]
 *   `includeCustomerContact` defaults to FALSE — the safe default. A broadcast
 *   offer goes to many riders who have no relationship with this order yet, so it
 *   must not carry the customer's name or phone number. Only call sites that emit
 *   to the single assigned rider (order_ready, admin assignment, the accept
 *   response) may pass true.
 */
export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null, options = {}) {
  const includeCustomerContact = options.includeCustomerContact === true;
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

  const tripDistanceKmRaw =
    order?.tripDistanceKm ??
    order?.pricing?.roadDistanceKm ??
    order?.pricing?.distanceKm ??
    order?.pricing?.straightLineDistanceKm;
  const tripDurationMinsRaw =
    order?.tripDurationMins ??
    order?.pricing?.roadDurationMins;
  const tripDistanceKm = Number.isFinite(Number(tripDistanceKmRaw))
    ? Number(Number(tripDistanceKmRaw).toFixed(2))
    : null;
  const tripDurationMins = Number.isFinite(Number(tripDurationMinsRaw))
    ? Math.ceil(Number(tripDurationMinsRaw))
    : (tripDistanceKm != null ? Math.max(1, Math.ceil((tripDistanceKm * 60) / 25)) : null);

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
    deliveryAddress: includeCustomerContact
      ? order?.deliveryAddress
      : redactDeliveryAddress(order?.deliveryAddress),
    customerAddress: customerAddressParts.length ? customerAddressParts.join(', ') : "",
    // Contact block: present only for the assigned rider. `customerContactAvailable`
    // lets the rider app render "contact unlocks on accept" without guessing.
    customerContactAvailable: includeCustomerContact,
    customerName: includeCustomerContact
      ? (order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "")
      : "",
    customerPhone: includeCustomerContact
      ? (order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "")
      : "",
    userName: includeCustomerContact
      ? (order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "")
      : "",
    userPhone: includeCustomerContact
      ? (order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "")
      : "",
    note: order?.note || "",
    tripDistanceKm,
    tripDurationMins,
    distanceKm: tripDistanceKm,
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

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Outlet timings are edited rarely but read on every cart recalculation, so a
 * short TTL keeps checkout fast without letting stale hours linger.
 */
const outletTimingsCache = createTtlCache({ ttlMs: 30_000, maxEntries: 2000, name: 'outlet-timings' });

/**
 * Resolve the wall-clock weekday/hour/minute in the business timezone.
 *
 * The previous implementation did `new Date(date.toLocaleString('en-US', { timeZone }))`,
 * which round-trips through a locale string and silently degrades to the server
 * timezone on Node builds without full ICU data - a 5.5h error that reads as
 * "restaurant closed". `formatToParts` reads the fields directly instead.
 */
function getZonedTimeParts(date, timeZone = 'Asia/Kolkata') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const lookup = {};
    for (const part of parts) lookup[part.type] = part.value;

    // hourCycle h23 still emits "24" for midnight in some ICU versions.
    const hour = Number(lookup.hour) % 24;
    const minute = Number(lookup.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || !lookup.weekday) {
      throw new Error('Incomplete date parts');
    }
    return { dayName: lookup.weekday, minutesOfDay: hour * 60 + minute };
  } catch (error) {
    // Last-resort fallback: server local time. Logged because it means the
    // deployment is missing ICU data and open/close checks may be off.
    logger.warn(`Timezone resolution failed for ${timeZone}, using server time: ${error?.message || error}`);
    return {
      dayName: DAYS_OF_WEEK[date.getDay()],
      minutesOfDay: date.getHours() * 60 + date.getMinutes(),
    };
  }
}

/** Parse "HH:mm" (also tolerates "H:mm" and "HH:mm:ss") into minutes since midnight. */
function parseTimeToMinutes(timeStr) {
  const raw = String(timeStr ?? '').trim();
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) return null;
  return (h % 24) * 60 + m;
}

/**
 * Pure open/closed decision, split out from the data loading so it can be
 * exercised directly in tests.
 *
 * @param {object} restaurant Fields: status, isAcceptingOrders, openingTime, closingTime, openDays
 * @param {object|null} timingDoc Outlet timings document, or null when none exists
 * @param {Date} checkDate Instant to evaluate
 * @returns {{ isOpen: boolean, reason?: string }}
 */
export function resolveRestaurantOpenStatus(restaurant, timingDoc, checkDate = new Date()) {
  if (!restaurant) {
    return { isOpen: false, reason: 'Restaurant not found' };
  }

  if (restaurant.status !== 'approved') {
    return { isOpen: false, reason: 'Restaurant not accepting orders' };
  }

  if (restaurant.isAcceptingOrders === false) {
    return { isOpen: false, reason: 'Restaurant is currently offline' };
  }

  const { dayName: currentDayName, minutesOfDay: currentMin } = getZonedTimeParts(checkDate);

  let openingTime = restaurant.openingTime || null;
  let closingTime = restaurant.closingTime || null;

  if (timingDoc && Array.isArray(timingDoc.timings) && timingDoc.timings.length > 0) {
    const timing = timingDoc.timings.find(
      (t) => t && String(t.day).trim().toLowerCase() === currentDayName.toLowerCase(),
    );
    if (timing) {
      if (timing.isOpen === false) {
        return { isOpen: false, reason: 'Restaurant is closed today' };
      }
      openingTime = timing.openingTime || openingTime;
      closingTime = timing.closingTime || closingTime;
    }
  } else if (Array.isArray(restaurant.openDays) && restaurant.openDays.length > 0) {
    const openDaysNormalized = restaurant.openDays.map((d) => String(d).trim().toLowerCase());
    if (!openDaysNormalized.includes(currentDayName.toLowerCase())) {
      return { isOpen: false, reason: 'Restaurant is closed today' };
    }
  }

  if (!openingTime || !closingTime) {
    // No hours configured -> treat as always open rather than blocking orders.
    return { isOpen: true };
  }

  const openMin = parseTimeToMinutes(openingTime);
  const closeMin = parseTimeToMinutes(closingTime);

  if (openMin === null || closeMin === null) {
    // Unparseable hours must not block checkout; fail open and flag it.
    logger.warn(
      `Restaurant has unparseable hours ("${openingTime}" - "${closingTime}"); treating as open`,
    );
    return { isOpen: true };
  }

  let isWithin;
  if (openMin === closeMin) {
    // Identical open/close (e.g. "00:00" to "00:00", or "09:00" to "09:00")
    // is the standard way to express a 24-hour outlet. The old code read this
    // as a zero-length window and reported every such restaurant as closed,
    // which rejected checkout with "Operational hours: 00:00 to 00:00".
    isWithin = true;
  } else if (closeMin < openMin) {
    // Overnight window (e.g. 18:00 to 02:00 next day)
    isWithin = currentMin >= openMin || currentMin <= closeMin;
  } else {
    // Normal same-day window (e.g. 09:00 to 22:00)
    isWithin = currentMin >= openMin && currentMin <= closeMin;
  }

  if (!isWithin) {
    return {
      isOpen: false,
      reason: `Restaurant is closed now. Operational hours: ${openingTime} to ${closingTime}`,
    };
  }

  return { isOpen: true };
}

/**
 * @param {string|import('mongoose').Types.ObjectId} restaurantId
 * @param {Date} [checkDate]
 * @param {{ restaurant?: object }} [options] Pre-fetched restaurant doc to skip a redundant query.
 */
export async function checkRestaurantOpenStatus(restaurantId, checkDate = new Date(), options = {}) {
  const { FoodRestaurant } = await import('../../restaurant/models/restaurant.model.js');

  // Callers that already loaded the restaurant can hand it over instead of
  // paying for a second point-query on the checkout hot path.
  const preloaded = options.restaurant;
  const hasRequiredFields =
    preloaded &&
    'status' in preloaded &&
    'openingTime' in preloaded &&
    'closingTime' in preloaded &&
    'openDays' in preloaded;

  const restaurant = hasRequiredFields
    ? preloaded
    : await FoodRestaurant.findById(restaurantId)
        .select('status isAcceptingOrders openingTime closingTime openDays')
        .lean();

  if (!restaurant) {
    return { isOpen: false, reason: 'Restaurant not found' };
  }

  const { FoodRestaurantOutletTimings } = await import('../../restaurant/models/outletTimings.model.js');
  const timingDoc = await outletTimingsCache.get(String(restaurantId), () =>
    // `null` is cached too, so restaurants without a timings doc do not re-query.
    FoodRestaurantOutletTimings.findOne({ restaurantId }).lean().then((doc) => doc ?? null),
  );

  return resolveRestaurantOpenStatus(restaurant, timingDoc, checkDate);
}

/** Drop cached outlet timings for a restaurant after its schedule is edited. */
export function invalidateOutletTimingsCache(restaurantId) {
  if (restaurantId) outletTimingsCache.delete(String(restaurantId));
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
      order.payment?.amountDue ??
      order.pricing?.total ??
      order.amounts?.payableAmount ??
      order.payableAmount ??
      order.total ??
      order.totalAmount ??
      0,
  );
}
