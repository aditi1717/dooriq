import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { tryGetFirebaseDB as getFirebaseDB } from '../../../../config/firebase.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import {
  buildDeliverySocketPayload,
  buildOrderIdentityFilter,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
  isCodOrder,
  extractOrderPayableAmount,
} from './order.helpers.js';
import { notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';
import {
  getDispatchConfig,
  resolveDispatchStage,
  saveDispatchConfig,
  buildPartnerBarredPredicate,
} from './dispatch-config.service.js';

/**
 * Structured dispatch telemetry.
 *
 * The logger JSON-stringifies objects, so emitting a consistent shape here makes
 * the dispatch lifecycle greppable and machine-parseable without pulling in a
 * logging framework. Never pass customer contact details through this.
 */
function dispatchLog(event, fields = {}, level = 'info') {
  const line = { event, at: new Date().toISOString(), ...fields };
  if (level === 'error') logger.error(line);
  else if (level === 'warn') logger.warn(line);
  else logger.info(line);
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

async function enrichPayloadWithTripRoadDistance(order, payload) {
  const existingRoadKm = Number(
    order?.tripDistanceKm ??
    order?.pricing?.roadDistanceKm ??
    order?.pricing?.distanceKm ??
    order?.pricing?.straightLineDistanceKm
  );
  if (Number.isFinite(existingRoadKm) && existingRoadKm > 0) {
    const km = Number(existingRoadKm.toFixed(2));
    const minsRaw = order?.tripDurationMins ?? order?.pricing?.roadDurationMins;
    const tripDurationMins = Number.isFinite(Number(minsRaw))
      ? Math.ceil(Number(minsRaw))
      : payload.tripDurationMins;
    return {
      ...payload,
      tripDistanceKm: km,
      tripDurationMins: tripDurationMins ?? null,
      distanceKm: km,
    };
  }

  const restaurantPoint = toPoint(order?.restaurantId) || toPoint(order?.restaurantId?.location);
  const customerPoint = toPoint(order?.deliveryAddress);
  if (!restaurantPoint || !customerPoint) {
    return payload;
  }

  try {
    const route = await fetchDrivingRoute(restaurantPoint, customerPoint);
    const routeDistanceKm = Number(route?.distanceKm);
    if (Number.isFinite(routeDistanceKm) && routeDistanceKm > 0) {
      const tripDurationMins = Number.isFinite(Number(route?.durationSeconds))
        ? Math.ceil(Number(route.durationSeconds) / 60)
        : null;

      if (order?._id) {
        FoodOrder.updateOne(
          { _id: order._id },
          {
            $set: {
              tripDistanceKm: routeDistanceKm,
              tripDurationMins,
              'pricing.distanceKm': routeDistanceKm,
              'pricing.roadDistanceKm': routeDistanceKm,
              'pricing.roadDurationMins': tripDurationMins,
            },
          },
        ).catch(() => {});
      }

      return {
        ...payload,
        tripDistanceKm: routeDistanceKm,
        tripDurationMins,
        distanceKm: routeDistanceKm,
      };
    }
  } catch (err) {
    logger.warn(`Trip road distance enrichment failed: ${err?.message || err}`);
  }

  return payload;
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  { maxKm = 15, limit = 25, order = null, config = null } = {},
) {
  const staleGpsMs = Number(config?.staleGpsMinutes ?? 10) * 60 * 1000;
  const includeStaleGpsRiders = config?.includeStaleGpsRiders !== false;
  const unboundedFallbackEnabled = config?.unboundedFallbackEnabled !== false;
  const rId = (restaurantId?._id || restaurantId).toString();
  const restaurant = await FoodRestaurant.findById(rId)
    .select("location")
    .lean();

  const allowedStatuses = process.env.NODE_ENV === 'production' ? ['approved'] : ['approved', 'pending'];

  const basePartnerFilter = {
    status: { $in: allowedStatuses },
    availabilityStatus: "online",
  };
  const partnerFields = "_id status lastLat lastLng lastLocationAt name";

  // The eligibility passes below (busy trip, cash limit) drop candidates, so the
  // pool is a multiple of the fanout limit rather than exactly `limit` rows.
  const candidatePoolSize = Math.max(Math.max(1, limit) * 4, 100);
  const restaurantCoords = restaurant?.location?.coordinates;
  const hasRestaurantGeo =
    Array.isArray(restaurantCoords) && restaurantCoords.length >= 2;

  /**
   * Condition 1: online, approved riders within the radius.
   *
   * This used to load *every* online rider on the platform and apply `maxKm` in
   * JS afterwards, then fan the two eligibility queries below out over that same
   * full id list. That is three fleet-sized reads per dispatch attempt, and every
   * unassigned order re-runs dispatch on a timer - so the cost scaled with
   * (live orders x fleet size) rather than with the fanout limit.
   *
   * The 2dsphere index on `lastLocation` already existed, so the radius is now
   * applied in the database. `$near` also returns results already sorted by
   * distance, which is the order the scoring pass below wants anyway.
   */
  let allOnline;
  if (hasRestaurantGeo) {
    allOnline = await FoodDeliveryPartner.find({
      ...basePartnerFilter,
      lastLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [restaurantCoords[0], restaurantCoords[1]],
          },
          $maxDistance: maxKm * 1000,
        },
      },
    })
      .select(partnerFields)
      .limit(candidatePoolSize)
      .lean();

    // Riders that have never reported a position are invisible to `$near`. They
    // only matter when policy says to include stale-GPS riders, and they always
    // sort last, so they are fetched separately and capped the same way.
    if (includeStaleGpsRiders) {
      const withoutGeo = await FoodDeliveryPartner.find({
        ...basePartnerFilter,
        $or: [{ lastLocation: { $exists: false } }, { lastLocation: null }],
      })
        .select(partnerFields)
        .limit(candidatePoolSize)
        .lean();
      allOnline = allOnline.concat(withoutGeo);
    }
  } else {
    // No restaurant geo means no radius can be applied at all; the fallback
    // policy further down decides what to do, but the read stays capped.
    allOnline = await FoodDeliveryPartner.find(basePartnerFilter)
      .select(partnerFields)
      .limit(candidatePoolSize)
      .lean();
  }

  const onlineIds = allOnline.map((p) => p._id).filter(Boolean);
  if (onlineIds.length === 0) {
    return { restaurant: null, partners: [] };
  }

  const busyPartnerIds = new Set();
  const cashLimitExceededPartnerIds = new Set();

  // Parallel checks for Busy Trips & Cash Limit Eligibility
  const [activeOrders, cashLimitDoc, wallets] = await Promise.all([
    FoodOrder.find({
      'dispatch.deliveryPartnerId': { $in: onlineIds },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'] },
      'dispatch.status': { $in: ['assigned', 'accepted'] },
    }).select('dispatch.deliveryPartnerId').lean().catch(() => []),
    FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean().catch(() => null),
    FoodDeliveryWallet.find({ deliveryPartnerId: { $in: onlineIds } }).select('deliveryPartnerId cashInHand').lean().catch(() => []),
  ]);

  for (const orderItem of activeOrders || []) {
    const pid = orderItem?.dispatch?.deliveryPartnerId;
    if (pid) busyPartnerIds.add(String(pid));
  }

  // Condition 2: Cash Limit Threshold Check
  const globalCashLimit = Number(cashLimitDoc?.deliveryCashLimit) || 0;
  if (globalCashLimit > 0) {
    const walletMap = new Map(
      (wallets || []).map((w) => [String(w.deliveryPartnerId), Number(w.cashInHand) || 0]),
    );
    const orderIsCod = isCodOrder(order);
    const orderAmount = extractOrderPayableAmount(order);

    for (const pid of onlineIds) {
      const pidStr = String(pid);
      const cashInHand = walletMap.get(pidStr) || 0;

      if (cashInHand >= globalCashLimit) {
        cashLimitExceededPartnerIds.add(pidStr);
      } else if (orderIsCod && cashInHand + orderAmount > globalCashLimit) {
        cashLimitExceededPartnerIds.add(pidStr);
      }
    }

    if (cashLimitExceededPartnerIds.size > 0) {
      logger.info(
        `Cash limit enforcement: Filtered out ${cashLimitExceededPartnerIds.size} delivery partners exceeding cash limit threshold (Limit: ₹${globalCashLimit}).`,
      );
    }
  }

  // Filter out busy and cash-limit exceeded partners
  const eligibleOnline = allOnline.filter(
    (p) =>
      !busyPartnerIds.has(String(p._id)) &&
      !cashLimitExceededPartnerIds.has(String(p._id)),
  );

  if (eligibleOnline.length === 0) {
    return { partners: [] };
  }

  if (!restaurant?.location?.coordinates?.length) {
    // No geo on the restaurant means no radius can be applied at all. Honour the
    // configured fallback policy instead of silently broadcasting platform-wide.
    if (!unboundedFallbackEnabled) {
      dispatchLog('ORDER_RIDERS_FOUND', {
        restaurantId: rId,
        riderCount: 0,
        reason: 'restaurant_missing_coordinates_and_unbounded_fallback_disabled',
      }, 'warn');
      return { restaurant: null, partners: [] };
    }
    return {
      restaurant: null,
      partners: eligibleOnline.slice(0, Math.max(1, limit)).map((p) => ({ partnerId: p._id, distanceKm: null })),
    };
  }

  const [rLng, rLat] = restaurant.location.coordinates;
  const scored = [];
  let staleGpsCount = 0;

  for (const p of eligibleOnline) {
    const isStale = !p.lastLocationAt || (Date.now() - new Date(p.lastLocationAt).getTime()) > staleGpsMs;
    if (p.lastLat == null || p.lastLng == null || isStale) {
      staleGpsCount += 1;
      // A rider with no fresh fix has an unknown position. Including them means the
      // configured radius does not actually bound the broadcast, so it is now a
      // policy choice rather than an unconditional behaviour. The 999 sentinel keeps
      // them sorted last when they are included.
      if (includeStaleGpsRiders) {
        scored.push({ partnerId: p._id, distanceKm: 999, status: p.status, staleGps: true });
      }
      continue;
    }

    const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
    if (Number.isFinite(d) && d <= maxKm) {
      scored.push({ partnerId: p._id, distanceKm: d, status: p.status, staleGps: false });
    }
  }

  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  const picked = scored.slice(0, Math.max(1, limit));

  if (picked.length === 0) {
    if (!unboundedFallbackEnabled) {
      return { partners: [], staleGpsCount };
    }
    // Legacy behaviour: nobody in range, so offer to whoever is online at any
    // distance. Configurable because it makes the radius advisory.
    return {
      partners: eligibleOnline.slice(0, Math.max(1, limit)).map((p) => ({
        partnerId: p._id,
        distanceKm: null,
        status: p.status,
      })),
      staleGpsCount,
      usedUnboundedFallback: true,
    };
  }

  // `config.env` never existed on the env config object (it exposes `nodeEnv`), so
  // this filter was dead code. The approved-only guarantee is enforced by the
  // `allowedStatuses` query above, which does read NODE_ENV correctly.
  return { partners: picked, staleGpsCount };
}

/**
 * Full dispatch policy for the admin panel. Previously returned a hardcoded
 * `{ dispatchMode: 'auto' }` and ignored the stored document entirely.
 *
 * `dispatchMode` is retained so existing callers keep working.
 */
export async function getDispatchSettings() {
  const config = await getDispatchConfig();
  return { dispatchMode: config.dispatchMode, config };
}

/**
 * Persist an admin-supplied dispatch policy.
 *
 * Back-compatible with the old two-argument signature: passing just a
 * dispatchMode string still works and simply leaves the policy untouched.
 *
 * @param {string|object} payload Legacy dispatchMode string, or a config object.
 * @param {string} adminId
 */
export async function updateDispatchSettings(payload, adminId) {
  const isLegacyModeOnly = typeof payload === 'string' || payload == null;

  if (isLegacyModeOnly) {
    await FoodSettings.findOneAndUpdate(
      { key: 'dispatch' },
      {
        $set: {
          dispatchMode: 'auto',
          updatedBy: { role: 'ADMIN', adminId, at: new Date() },
        },
      },
      { upsert: true, new: true },
    );
    return getDispatchSettings();
  }

  const config = await saveDispatchConfig(payload, adminId);
  return { dispatchMode: config.dispatchMode, config };
}

export async function tryAutoAssign(orderId, options = {}) {
  // `options.attempt` is authoritative and threaded through the whole retry chain
  // (producer -> queue -> processor -> service -> here). Only fall back to 1 when a
  // caller genuinely starts a fresh hunt.
  const parsedAttempt = Number(options.attempt);
  const attempt = Number.isFinite(parsedAttempt) && parsedAttempt >= 1 ? Math.floor(parsedAttempt) : 1;

  const config = await getDispatchConfig();
  const lockTimeout = 30000; // 30 seconds lock interval

  const order = await FoodOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.acceptedAt': { $exists: false },
          'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) }
        }
      ],
      'dispatch.dispatchingAt': { $exists: false }
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId']);

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (already dispatching, accepted, or multi-attempt lock active).`);
    return null;
  }

  dispatchLog('ORDER_DISPATCH_STARTED', {
    orderId: String(orderId),
    orderFriendlyId: order.order_id || String(orderId),
    attempt,
    orderStatus: order.orderStatus,
    configuredStages: config.stages.length,
    radiusExpansionEnabled: config.radiusExpansionEnabled,
  });

  try {
    // Decoupling: Ensure order is accepted by restaurant before dispatching to delivery boys.
    //
    // This gate must stay INSIDE the try. When it sat above it, an early return skipped
    // the `finally` that clears `dispatch.dispatchingAt`, so the lock leaked and every
    // later tryAutoAssign for that order failed its `$exists: false` precondition —
    // the order silently stopped dispatching until the next server restart.
    // Statuses where handing the order to a DIFFERENT rider is still coherent.
    //
    // `picked_up` and `reached_drop` were removed: the food is already in a bag on
    // a rider's bike, so broadcasting it to fresh riders produces two people who
    // both believe they own the delivery. `'ready'` was removed too — it is not in
    // the orderStatus enum, so it could never match anything.
    // `reached_pickup` stays: the rider is at the restaurant but has not collected
    // the food, so an admin deassign there can legitimately re-dispatch.
    const DISPATCHABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup'];
    if (!DISPATCHABLE_STATUSES.includes(order.orderStatus)) {
      logger.info(`tryAutoAssign: Skip for ${orderId} (status ${order.orderStatus} not dispatchable yet).`);
      return order;
    }

    const offerHistory = order.dispatch?.offeredTo || [];

    // Riders who already hold a LIVE offer — do not ring them twice for the same order.
    const activeOfferIds = new Set(
      offerHistory
        .filter((offer) => String(offer.action || 'offered') === 'offered')
        .map((offer) => offer.partnerId.toString()),
    );

    // Riders currently barred: an explicit rejection or deassignment (permanent),
    // or a timeout still inside its cooldown. Once a timeout has cooled off the
    // rider becomes eligible for a FRESH offer again, which is the whole point of
    // the cooldown — previously a single missed countdown barred them for good.
    const isBarred = buildPartnerBarredPredicate(offerHistory, config);

    // DYNAMIC RADIUS: the ladder comes entirely from admin configuration.
    // attempt 1 -> stages[0], attempt 2 -> stages[1], ... and once the ladder is
    // exhausted the configured finalStageBehavior decides, rather than the code
    // inventing another radius.
    const stage = resolveDispatchStage(config, attempt);
    const maxKm = stage.radiusKm;

    dispatchLog('ORDER_DISPATCH_STAGE_STARTED', {
      orderId,
      attempt,
      stage: stage.stageNumber,
      totalStages: stage.totalStages,
      radiusKm: maxKm,
      timeoutSeconds: stage.timeoutSeconds,
      stagesExhausted: stage.stagesExhausted,
      reason: stage.reason,
    });

    // Crisis escalation is now driven by the real attempt number. It used to be
    // derived from offeredTo.length, which counts RIDERS not attempts, so a single
    // broadcast to 15 riders tripped the "unassigned for 6 minutes" alarm after 30s.
    if (stage.isCrisis) {
      await escalateDispatchCrisis(order, stage);
    }

    if (stage.shouldStop) {
      dispatchLog('ORDER_DISPATCH_EXHAUSTED', {
        orderId,
        attempt,
        stage: stage.stageNumber,
        maxAttempts: config.maxAttempts,
        finalStageBehavior: config.finalStageBehavior,
        reason: stage.reason,
      }, 'warn');
      // Configured policy says stop hunting. No further retry is scheduled; the
      // order stays unassigned and waits for manual admin assignment.
      return order;
    }

    const searchOptions = { maxKm, limit: config.riderFanoutLimit, order, config };
    const { partners, staleGpsCount = 0, usedUnboundedFallback = false } =
      await listNearbyOnlineDeliveryPartners(order.restaurantId, searchOptions);

    dispatchLog('ORDER_RIDERS_FOUND', {
      orderId,
      attempt,
      stage: stage.stageNumber,
      radiusKm: maxKm,
      riderCount: partners.length,
      staleGpsCount,
      usedUnboundedFallback,
      fanoutLimit: config.riderFanoutLimit,
    });

    // Eligible for a NEW offer: not already holding a live one, and not barred.
    const eligible = partners.filter((p) => {
      const pid = p.partnerId.toString();
      return !activeOfferIds.has(pid) && !isBarred(pid);
    });

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);

      // The doc was loaded before the candidate lookup, so re-read the claim state:
      // re-ringing every rider for an order somebody already accepted is the same
      // ghost-offer bug as the main broadcast path.
      const alreadyClaimed = await FoodOrder.exists({
        _id: order._id,
        'dispatch.status': 'accepted',
      });
      if (alreadyClaimed) {
        logger.info(`tryAutoAssign: Order ${order._id} already accepted; skipping re-offer.`);
        return order;
      }

      // If we ran out of new eligible partners, we might want to re-offer to everyone (Phase 2 style)
      const io = getIO();
      const reofferEligible = partners.filter(
        (partner) => !isBarred(partner.partnerId.toString())
      );
      if (reofferEligible.length > 0) {
        const basePayload = buildDeliverySocketPayload(order, order.restaurantId);
        const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);
        const db = getFirebaseDB();
        if (db) {
          for (const p of reofferEligible) {
            db.ref(`delivery_offers/${p.partnerId}/${order._id.toString()}`).set({
              ...payload,
              offerCountdownSeconds: config.offerCountdownSeconds,
              offeredAt: Date.now()
            }).catch(() => {});
          }
        }
        if (io) {
          for (const p of reofferEligible) {
            const roomName = rooms.delivery(p.partnerId);
            io.to(roomName).emit('new_order_available', { ...payload, offerCountdownSeconds: config.offerCountdownSeconds });
          }
        }
      }

      // Re-queue itself to keep trying, at the configured cadence for this stage.
      await scheduleDispatchRetry(order._id.toString(), attempt + 1, stage.timeoutMs, 'no_new_eligible_riders');

      return order;
    }

    const offeredToEntries = eligible.map(p => ({
      partnerId: p.partnerId,
      at: new Date(),
      action: 'offered'
    }));

    // Record the offers atomically BEFORE fanning out, and only while the order is
    // still unclaimed.
    //
    // The previous version mutated the document loaded at the top of this function and
    // called save() *after* awaiting the FCM batch (a multi-second window for 15 riders).
    // A rider accepting inside that window had their claim overwritten by
    // status:'unassigned' / deliveryPartnerId:null — they kept the trip on screen while
    // the order went back on the market and was offered to everyone else. That is the
    // double-assignment. A conditional update cannot clobber a concurrent accept.
    const claim = await FoodOrder.updateOne(
      {
        _id: order._id,
        'dispatch.status': { $ne: 'accepted' },
        'dispatch.acceptedAt': { $exists: false },
      },
      {
        $set: {
          'dispatch.status': 'unassigned',
          'dispatch.deliveryPartnerId': null,
        },
        $push: { 'dispatch.offeredTo': { $each: offeredToEntries } },
      },
    );

    if (claim.matchedCount === 0) {
      logger.info(`tryAutoAssign: Order ${order._id} was claimed before broadcast; skipping fan-out.`);
      return order;
    }

    // Keep the in-memory doc in step so the offer payload carries this round's
    // offeredTo entries. The rider app derives its countdown from the matching
    // entry's `at`, so the timer now survives an app restart instead of resetting.
    order.dispatch.offeredTo.push(...offeredToEntries);

    const io = getIO();
    // includeCustomerContact:false — an OFFER must never carry the customer's phone
    // or name. Contact details are released only to the rider who wins the accept.
    const basePayload = buildDeliverySocketPayload(order, order.restaurantId, {
      includeCustomerContact: false,
    });
    const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);

    // BROADCAST: Notify all eligible riders via Firebase and Sockets
    dispatchLog('ORDER_OFFERED', {
      orderId,
      attempt,
      stage: stage.stageNumber,
      radiusKm: maxKm,
      riderCount: eligible.length,
      tripDistanceKm: payload.tripDistanceKm,
      countdownSeconds: config.offerCountdownSeconds,
    });
    const db = getFirebaseDB();
    if (db) {
      for (const p of eligible) {
        db.ref(`delivery_offers/${p.partnerId}/${order._id.toString()}`).set({
          ...payload,
          offerCountdownSeconds: config.offerCountdownSeconds,
          offeredAt: Date.now()
        }).catch(() => {});
      }
    }
    for (const p of eligible) {
      const roomName = rooms.delivery(p.partnerId);
      if (io) io.to(roomName).emit('new_order', { ...payload, offerCountdownSeconds: config.offerCountdownSeconds });
    }

    // Batch Push Notifications
    const pushTargets = eligible.map(p => ({
      ownerType: 'DELIVERY_PARTNER',
      ownerId: p.partnerId
    }));

    if (pushTargets.length > 0) {
      try {
        await notifyOwnersSafely(
          pushTargets,
          {
            title: 'New order available!',
            body: `Order #${order.order_id || order._id} is available. You have ${config.offerCountdownSeconds} seconds to accept!`,
            data: { type: 'new_order', orderId: order._id.toString() },
          }
        );
      } catch (err) {
        logger.warn(`Push notifications failed for broadcast on order ${order._id}: ${err.message}`);
      }
    }

    // A rider can still accept mid-broadcast. If they did, their accept handler already
    // swept the offer nodes — before some of ours existed — so clear what we just wrote
    // rather than leaving ghost offers ringing on other riders' phones, and do not
    // schedule another hunt for an order that now has an owner.
    const claimedDuringBroadcast = await FoodOrder.exists({
      _id: order._id,
      'dispatch.status': 'accepted',
    });
    if (claimedDuringBroadcast) {
      dispatchLog('ORDER_OFFER_REMOVED', {
        orderId,
        attempt,
        riderCount: eligible.length,
        reason: 'accepted_during_broadcast',
      });
      if (db) {
        for (const p of eligible) {
          db.ref(`delivery_offers/${p.partnerId}/${order._id.toString()}`).remove().catch(() => {});
        }
      }
      return order;
    }

    // Escalate to the next configured stage after this stage's own timeout.
    await scheduleDispatchRetry(order._id.toString(), attempt + 1, stage.timeoutMs, 'stage_timeout');

    return order;
  } finally {
    await FoodOrder.findByIdAndUpdate(orderId, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
  }
}


/**
 * Resolve the attempt number for a retry.
 *
 * `options.attempt` is the authoritative value, carried on the queue job that
 * scheduled this check. The old code ignored the argument entirely (the function
 * only declared two parameters) and recomputed the attempt as
 * `offeredTo.length + 1`. Because a single broadcast appends one entry PER RIDER,
 * a first-round fan-out to 15 riders made "attempt 16" — which skipped the whole
 * radius ladder and tripped the crisis alarm 30 seconds into the order.
 *
 * The rider-count heuristic survives only as a last-resort fallback for jobs
 * enqueued by an older build that carry no attempt field.
 */
function resolveRetryAttempt(order, options = {}) {
  const parsed = Number(options?.attempt);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return { attempt: Math.floor(parsed), source: 'job' };
  }

  const distinctOfferRounds = new Set(
    (order?.dispatch?.offeredTo || [])
      .map((entry) => (entry?.at ? new Date(entry.at).getTime() : null))
      .filter((ts) => Number.isFinite(ts)),
  ).size;

  // Entries pushed in the same broadcast share a timestamp, so counting DISTINCT
  // timestamps approximates rounds far better than counting riders.
  return { attempt: Math.max(1, distinctOfferRounds) + 1, source: 'legacy_fallback' };
}

/**
 * @param {string} orderId
 * @param {string|null} partnerId Partner whose individual offer timed out, if any.
 * @param {{ attempt?: number }} [options] Job data forwarded from the queue.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
  const order = await FoodOrder.findById(orderId);
  if (!order) return;

  const { attempt, source } = resolveRetryAttempt(order, options);

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  const clearPartnerOffer = () => {
    if (!partnerId) return;
    const db = getFirebaseDB();
    if (db) {
      db.ref(`delivery_offers/${partnerId}/${orderId}`).remove().catch(() => {});
    }
  };

  if (stillAssigned) {
    dispatchLog('ORDER_DISPATCH_RETRY', {
      orderId,
      attempt,
      attemptSource: source,
      partnerId: String(partnerId),
      reason: 'assigned_offer_timed_out',
    });
    const offer = order.dispatch.offeredTo.find(
      o => String(o.partnerId) === String(partnerId) && o.action === 'offered'
    );
    if (offer) offer.action = 'timeout';

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    await order.save();

    clearPartnerOffer();
    await tryAutoAssign(orderId, { attempt });
  } else if (order.dispatch?.status === 'unassigned') {
    // Already unassigned (e.g. a previous timeout) — keep hunting at the real attempt.
    dispatchLog('ORDER_DISPATCH_RETRY', {
      orderId,
      attempt,
      attemptSource: source,
      partnerId: partnerId ? String(partnerId) : null,
      reason: 'stage_timeout_elapsed',
    });
    clearPartnerOffer();
    await tryAutoAssign(orderId, { attempt });
  }
}


/**
 * Schedule the next hunt. A deterministic jobId lets BullMQ collapse duplicate
 * chains: reject-then-retry used to start a second 30s timer alongside the first,
 * so a single order could be broadcast by two independent loops.
 */
async function scheduleDispatchRetry(orderKey, nextAttempt, delayMs, reason) {
  try {
    await addOrderJob(
      {
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: orderKey,
        orderId: orderKey,
        attempt: nextAttempt,
      },
      {
        delay: delayMs,
        jobId: `dispatch:${orderKey}:${nextAttempt}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    dispatchLog('ORDER_DISPATCH_RETRY_SCHEDULED', {
      orderId: orderKey,
      nextAttempt,
      delayMs,
      reason,
    });
  } catch (err) {
    dispatchLog('ORDER_DISPATCH_RETRY_SCHEDULE_FAILED', {
      orderId: orderKey,
      nextAttempt,
      error: err?.message || String(err),
    }, 'error');
  }
}

/**
 * Alert admins that an order cannot find a rider.
 *
 * The previous implementation targeted `{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }`,
 * which resolves to `FoodAdmin.findById('GLOBAL')` — a CastError that the safe
 * notification wrapper swallowed. No admin ever received this alert. We now use
 * `notifyAdminsSafely()` (which fans out to every active admin) AND emit into the
 * `admin:orders` socket room the dashboard already listens on.
 */
async function escalateDispatchCrisis(order, stage) {
  const orderKey = order._id.toString();
  const displayId = order.order_id || orderKey;

  dispatchLog('ORDER_DISPATCH_CRISIS', {
    orderId: orderKey,
    orderFriendlyId: displayId,
    attempt: stage.attempt,
    stage: stage.stageNumber,
    totalStages: stage.totalStages,
    radiusKm: stage.radiusKm,
    stagesExhausted: stage.stagesExhausted,
    restaurantId: String(order.restaurantId?._id || order.restaurantId || ''),
  }, 'error');

  const title = 'Unassigned order needs attention';
  const body = `Order #${displayId} has been through ${stage.attempt} dispatch attempts (up to ${stage.radiusKm} km) without a rider. Manual assignment required.`;

  try {
    await notifyAdminsSafely({
      title,
      body,
      data: {
        type: 'admin_dispatch_crisis',
        orderId: orderKey,
        orderMongoId: orderKey,
        attempt: String(stage.attempt),
        radiusKm: String(stage.radiusKm),
        link: `/admin/food/orders/all?orderId=${orderKey}`,
      },
    });
  } catch (err) {
    // Explicitly logged rather than swallowed — a silent crisis alert is how this
    // failure stayed invisible in the first place.
    dispatchLog('ORDER_DISPATCH_CRISIS_NOTIFY_FAILED', {
      orderId: orderKey,
      channel: 'fcm',
      error: err?.message || String(err),
    }, 'error');
  }

  try {
    const io = getIO();
    if (io) {
      const payload = {
        id: orderKey,
        orderId: orderKey,
        orderMongoId: orderKey,
        orderFriendlyId: displayId,
        title,
        message: body,
        severity: 'critical',
        attempt: stage.attempt,
        stage: stage.stageNumber,
        radiusKm: stage.radiusKm,
        targetType: 'ADMIN',
        link: `/admin/food/orders/all?orderId=${orderKey}`,
        createdAt: new Date().toISOString(),
      };
      // Dedicated event for future purpose-built dashboard UI...
      io.to('admin:orders').emit('admin_dispatch_crisis', payload);
      // ...plus the generic event the dashboard already renders today, so the
      // alert surfaces with no frontend change required.
      io.to('admin:orders').emit('admin_notification', payload);
    } else {
      dispatchLog('ORDER_DISPATCH_CRISIS_NOTIFY_FAILED', {
        orderId: orderKey,
        channel: 'socket',
        error: 'Socket.IO unavailable in this process',
      }, 'warn');
    }
  } catch (err) {
    dispatchLog('ORDER_DISPATCH_CRISIS_NOTIFY_FAILED', {
      orderId: orderKey,
      channel: 'socket',
      error: err?.message || String(err),
    }, 'error');
  }
}

/**
 * Remove every Firebase offer node for an order.
 * Exported so all three cancellation paths share one implementation.
 */
export async function cleanupFirebaseOffersForOrder(order) {
  try {
    const db = getFirebaseDB();
    if (!db || !order?._id) return;

    const orderKey = order._id.toString();
    const offeredPartners = order.dispatch?.offeredTo || [];
    for (const offer of offeredPartners) {
      const pid = offer.partnerId?.toString?.();
      if (!pid) continue;
      db.ref(`delivery_offers/${pid}/${orderKey}`).remove().catch(() => {});
    }

    const currentPartnerId = order.dispatch?.deliveryPartnerId?.toString?.();
    if (currentPartnerId) {
      db.ref(`delivery_offers/${currentPartnerId}/${orderKey}`).remove().catch(() => {});
    }
  } catch (err) {
    logger.warn(`cleanupFirebaseOffersForOrder failed: ${err?.message || err}`);
  }
}

/**
 * Single cleanup path for a cancelled order, shared by user / restaurant / admin
 * cancellation and the acceptance-deadline sweep.
 *
 * Previously only the admin path removed Firebase offers, and every path notified
 * just `dispatch.deliveryPartnerId` — which is null while an order is still being
 * broadcast. The riders holding the popup were therefore never told, and their
 * Firebase subscription kept re-raising the offer: the ghost-offer bug.
 *
 * @param {object} order Order document (or lean object) with dispatch.offeredTo.
 * @param {{ cancelledBy?: string, reason?: string }} [meta]
 */
export async function releaseOrderOffers(order, meta = {}) {
  if (!order?._id) return { notifiedPartnerIds: [] };

  const orderKey = order._id.toString();
  const cancelledBy = meta.cancelledBy || 'system';

  await cleanupFirebaseOffersForOrder(order);

  const partnerIds = new Set();
  for (const offer of order.dispatch?.offeredTo || []) {
    const pid = offer?.partnerId?.toString?.();
    if (pid) partnerIds.add(pid);
  }
  const assignedId = order.dispatch?.deliveryPartnerId?.toString?.();
  if (assignedId) partnerIds.add(assignedId);

  try {
    const io = getIO();
    if (io && partnerIds.size > 0) {
      const payload = {
        orderId: orderKey,
        orderMongoId: orderKey,
        orderFriendlyId: order.order_id || orderKey,
        orderStatus: order.orderStatus,
        status: 'cancelled',
        cancelledBy,
        reason: meta.reason || '',
      };
      for (const pid of partnerIds) {
        io.to(rooms.delivery(pid)).emit('order_cancelled', payload);
      }
    }
  } catch (err) {
    logger.warn(`releaseOrderOffers socket emit failed: ${err?.message || err}`);
  }

  dispatchLog('ORDER_CANCELLED', {
    orderId: orderKey,
    orderFriendlyId: order.order_id || orderKey,
    cancelledBy,
    notifiedRiderCount: partnerIds.size,
    orderStatus: order.orderStatus,
  });

  return { notifiedPartnerIds: [...partnerIds] };
}


export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  await cleanupFirebaseOffersForOrder(order);
  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  // Clear any in-flight dispatch lock. A resend is an explicit operator override,
  // and rejectOrderDelivery fires tryAutoAssign un-awaited — without this, a resend
  // issued while that background hunt still held the lock was a silent no-op that
  // still reported success.
  order.dispatch.dispatchingAt = undefined;
  await order.save();

  const dispatched = await tryAutoAssign(order._id);
  if (!dispatched) {
    dispatchLog('ORDER_DISPATCH_RESEND_NOOP', {
      orderId: order._id.toString(),
      reason: 'tryAutoAssign declined (order claimed or lock still held)',
    }, 'warn');
  }
  return { success: true, dispatched: Boolean(dispatched) };
}

export async function resendDeliveryNotificationAdmin(orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order. Please use Deassign & Resend instead.');
  }

  await cleanupFirebaseOffersForOrder(order);
  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  // Clear any in-flight dispatch lock. A resend is an explicit operator override,
  // and rejectOrderDelivery fires tryAutoAssign un-awaited — without this, a resend
  // issued while that background hunt still held the lock was a silent no-op that
  // still reported success.
  order.dispatch.dispatchingAt = undefined;
  await order.save();

  const dispatched = await tryAutoAssign(order._id);
  if (!dispatched) {
    dispatchLog('ORDER_DISPATCH_RESEND_NOOP', {
      orderId: order._id.toString(),
      reason: 'tryAutoAssign declined (order claimed or lock still held)',
    }, 'warn');
  }
  return { success: true, dispatched: Boolean(dispatched) };
}
