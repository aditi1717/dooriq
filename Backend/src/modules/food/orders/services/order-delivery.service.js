import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';

import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { tryGetFirebaseDB as getFirebaseDB } from '../../../../config/firebase.js';
import { fetchPolyline } from '../utils/googleMaps.js';

import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import {
  getDispatchConfig,
  buildPartnerNotBarredFilter,
  buildPartnerBarredPredicate,
} from './dispatch-config.service.js';
import * as paymentService from './order-payment.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';

import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
  pushStatusHistory,
  sanitizeOrderForExternal,
  haversineKm,
  isStatusAdvance,
  isCodOrder,
  extractOrderPayableAmount,
} from './order.helpers.js';

const TERMINAL_ORDER_STATUSES = [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
];

async function partnerHasActiveDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) return false;

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const activeOrder = await FoodOrder.exists({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
  });

  return Boolean(activeOrder);
}

function emitOrderUpdate(order, deliveryPartnerId) {
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderFriendlyId: order.order_id || order._id.toString(),
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.restaurant(order.restaurantId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order._id.toString();
    const displayOrderId = order.order_id || order.orderId || orderId;

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${displayOrderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${displayOrderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${displayOrderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${displayOrderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${displayOrderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${displayOrderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${displayOrderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnersSafely(
        [
          { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
          { ownerType: 'USER', ownerId: order.userId },
        ],
        {
          title: userTitle,
          body: userBody,
          dataOnly: true,
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          dataOnly: true,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const order = await FoodOrder.findOne({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: {
      $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'],
    },
  })
    .populate({
      path: 'restaurantId',
      select: 'restaurantName name phone primaryContactNumber ownerPhone location addressLine1 area city state profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = sanitizeOrderForExternal(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const dispatchConfig = await getDispatchConfig();
  const hasActiveDelivery = await partnerHasActiveDelivery(deliveryPartnerId);

  const filter = hasActiveDelivery
    ? {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
      }
    : {
        $or: [
          {
            'dispatch.status': 'unassigned',
            orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
          },
          {
            'dispatch.deliveryPartnerId': partnerId,
            'dispatch.status': { $in: ['assigned', 'accepted'] },
            orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
          },
        ],
      };

  const queryLimit = hasActiveDelivery ? limit : Math.max(limit * 5, 50);

  const docs = await FoodOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(queryLimit)
    .populate('userId', 'name phone email')
    .populate(
      'restaurantId',
      'restaurantName name address phone ownerPhone location profileImage',
    )
    .lean();

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  let enriched = (docs || []).map((doc) => {
    const tx = txByOrderId.get(String(doc?._id)) || null;
    if (!tx) return doc;
    return {
      ...doc,
      paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
      payment: tx.payment || doc.payment,
      pricing: tx.pricing || doc.pricing,
      amounts: tx.amounts || doc.amounts,
      transactionStatus: tx.status || doc.transactionStatus,
    };
  });

  if (!hasActiveDelivery) {
    const partner = await FoodDeliveryPartner.findById(partnerId)
      .select('lastLat lastLng lastLocationAt')
      .lean();

    const MAX_OFFER_KM = 20;
    const partnerLat = partner?.lastLat;
    const partnerLng = partner?.lastLng;
    const hasPartnerGps =
      partnerLat != null &&
      partnerLng != null &&
      Number.isFinite(Number(partnerLat)) &&
      Number.isFinite(Number(partnerLng));

    const withMeta = enriched.map((order) => {
      const assignedToMe = Boolean(
        order?.dispatch?.deliveryPartnerId &&
          String(order.dispatch.deliveryPartnerId) === String(partnerId),
      );

      const offeredToMe = Array.isArray(order?.dispatch?.offeredTo)
        ? order.dispatch.offeredTo.some(
            (entry) =>
              String(entry?.partnerId) === String(partnerId) &&
              String(entry?.action || 'offered') === 'offered',
          )
        : false;
      // Same cooldown rule the dispatcher uses: an expired timeout no longer hides
      // the order, so a rider who missed one countdown can still see a re-offer.
      const ignoredByMe = buildPartnerBarredPredicate(
        order?.dispatch?.offeredTo || [],
        dispatchConfig,
      )(partnerId);

      let distanceKm = null;
      const coords = order?.restaurantId?.location?.coordinates;
      if (hasPartnerGps && Array.isArray(coords) && coords.length >= 2) {
        const [rLng, rLat] = coords;
        const d = haversineKm(
          Number(partnerLat),
          Number(partnerLng),
          Number(rLat),
          Number(rLng),
        );
        if (Number.isFinite(d)) distanceKm = d;
      }

      return { order, assignedToMe, offeredToMe, ignoredByMe, distanceKm };
    });

    // STRICT DISPATCH: only orders this rider was actually offered (or is already
    // assigned) may appear. The previous rule also surfaced any unassigned order
    // within a hardcoded 20 km — which is how riders could accept orders the
    // dispatcher had deliberately excluded them from, and why the distance ranking
    // was effectively decorative. MAX_OFFER_KM now only bounds display of an
    // already-offered order, it can no longer grant access to one.
    const kept = withMeta.filter(({ assignedToMe, offeredToMe, ignoredByMe }) => {
      if (ignoredByMe) return false;
      if (assignedToMe) return true;
      return offeredToMe;
    });

    kept.sort((a, b) => {
      if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
      if (a.offeredToMe !== b.offeredToMe) return a.offeredToMe ? -1 : 1;
      const da = a.distanceKm == null ? Infinity : a.distanceKm;
      const db = b.distanceKm == null ? Infinity : b.distanceKm;
      return da - db;
    });

    enriched = kept.map(({ order }) => order);

    // Cash Limit Check: Filter out COD orders if adding them exceeds rider's available cash limit
    try {
      const [cashLimitDoc, wallet] = await Promise.all([
        FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean().catch(() => null),
        FoodDeliveryWallet.findOne({ deliveryPartnerId: partnerId }).lean().catch(() => null),
      ]);

      const globalCashLimit = Number(cashLimitDoc?.deliveryCashLimit) || 0;
      if (globalCashLimit > 0) {
        const cashInHand = Number(wallet?.cashInHand) || 0;

        if (cashInHand >= globalCashLimit) {
          // Driver has reached/exceeded cash limit; filter out unassigned orders
          enriched = enriched.filter(
            (order) =>
              order?.dispatch?.deliveryPartnerId &&
              String(order.dispatch.deliveryPartnerId) === String(partnerId),
          );
        } else {
          // Driver has some remaining limit; filter out COD orders exceeding remaining limit
          enriched = enriched.filter((order) => {
            if (!isCodOrder(order)) return true;
            const orderAmount = extractOrderPayableAmount(order);
            return cashInHand + orderAmount <= globalCashLimit;
          });
        }
      }
    } catch (cashLimitErr) {
      logger.warn(`Cash limit check error in listOrdersAvailableDelivery: ${cashLimitErr.message}`);
    }
  }

  const total = enriched.length;
  const paged = hasActiveDelivery
    ? enriched.slice(0, limit)
    : enriched.slice(skip, skip + limit);

  // Contact details are released only after a rider wins the accept. An order the
  // rider merely has an OFFER for must not carry the customer's name or phone, and
  // a direct call to this API must not be a way around that.
  const safeDocs = paged.map((doc) => {
    const isMine =
      String(doc?.dispatch?.deliveryPartnerId || '') === String(partnerId) &&
      doc?.dispatch?.status === 'accepted';
    return sanitizeOrderForExternal(doc, { includeCustomerContact: isMine });
  });

  return buildPaginatedResult({ docs: safeDocs, total, page, limit });
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

  // Parallel Cash Limit & Order Pre-check
  try {
    const [cashLimitDoc, wallet, orderToAccept] = await Promise.all([
      FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean().catch(() => null),
      FoodDeliveryWallet.findOne({ deliveryPartnerId: partnerId }).lean().catch(() => null),
      FoodOrder.findOne(identity).lean().catch(() => null),
    ]);

    const globalCashLimit = Number(cashLimitDoc?.deliveryCashLimit) || 0;
    if (globalCashLimit > 0) {
      const cashInHand = Number(wallet?.cashInHand) || 0;

      if (cashInHand >= globalCashLimit) {
        throw new ValidationError(
          `Your cash-in-hand (₹${cashInHand}) has reached or exceeded the cash limit of ₹${globalCashLimit}. Please deposit cash to accept new orders.`,
        );
      }

      if (orderToAccept) {
        const isCod = isCodOrder(orderToAccept);
        const orderAmount = extractOrderPayableAmount(orderToAccept);

        if (isCod && cashInHand + orderAmount > globalCashLimit) {
          throw new ValidationError(
            `Accepting this COD order (₹${orderAmount}) would exceed your cash-in-hand limit of ₹${globalCashLimit}. Your current cash-in-hand is ₹${cashInHand}. Please deposit cash first.`,
          );
        }
      }
    }
  } catch (cashLimitErr) {
    if (cashLimitErr instanceof ValidationError) throw cashLimitErr;
    logger.warn(`Cash limit check warning in acceptOrderDelivery: ${cashLimitErr.message}`);
  }

  const now = new Date();
  const dispatchConfig = await getDispatchConfig();
  const acceptedStatuses = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const alreadyOnTrip = await partnerHasActiveDelivery(deliveryPartnerId);
  if (alreadyOnTrip) {
    const existingActive = await FoodOrder.findOne({
      'dispatch.deliveryPartnerId': partnerId,
      'dispatch.status': 'accepted',
      orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
    })
      .select('_id order_id orderId')
      .lean();

    const activeOrderKey = String(existingActive?._id || '');
    const requestedOrder = await FoodOrder.findOne(identity).select('_id').lean();
    const requestedOrderKey = String(requestedOrder?._id || '');

    if (activeOrderKey && requestedOrderKey && activeOrderKey === requestedOrderKey) {
      const acceptedOrder = await FoodOrder.findOne(identity).populate('restaurantId userId');
      return acceptedOrder ? sanitizeOrderForExternal(acceptedOrder) : null;
    }

    throw new ValidationError(
      'You already have an active delivery. Complete it before accepting another order.',
    );
  }

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  // STRICT DISPATCH + ATOMIC CLAIM.
  //
  // Every rule lives in this single conditional update, so the winner is decided by
  // MongoDB's per-document atomicity rather than by read-then-write logic that two
  // concurrent requests could both pass. Two riders tapping Accept in the same
  // millisecond both run this update; exactly one matches, the loser gets null.
  //
  // The rules, and why each is here:
  //   orderStatus IN acceptedStatuses   - not cancelled, not already delivered
  //   dispatch.status === 'unassigned'  - nobody holds it (accepted/assigned excluded)
  //   dispatch.acceptedAt not set       - defence in depth against a stale status
  //   offeredTo $elemMatch action:offered - THIS rider was actually offered the order.
  //       Previously absent: any rider who could see the order in the available list
  //       (a hardcoded 20 km radius) could accept it, which made the ranked broadcast
  //       purely advisory and let excluded riders (cash limit, distance) grab orders.
  //   offeredTo NOT rejected/timeout/deassigned - they already passed on it
  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderStatus: { $in: acceptedStatuses },
      $and: [
        {
          $or: [
            {
              'dispatch.status': 'unassigned',
              'dispatch.acceptedAt': { $exists: false },
              'dispatch.offeredTo': {
                $elemMatch: { partnerId, action: 'offered' },
              },
            },
            {
              // Admin-assigned directly to this rider: an explicit assignment is
              // itself the authorisation, so no offeredTo entry is required.
              'dispatch.status': 'assigned',
              'dispatch.deliveryPartnerId': partnerId,
            },
          ],
        },
        // Not barred: explicit rejection / deassignment is permanent, while a
        // timeout only bars the rider for the configured cooldown. Shared with the
        // dispatcher so the two can never disagree about eligibility.
        buildPartnerNotBarredFilter(partnerId, dispatchConfig),
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
      },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    { new: true },
  ).populate('restaurantId userId');

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order is no longer available. It was cancelled.');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }

    // IDEMPOTENCY: a network retry of a request that already succeeded must return
    // the same success, not an error, and must not create a second assignment.
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? sanitizeOrderForExternal(acceptedOrder, { includeCustomerContact: true })
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order is no longer available');
    }

    // Strict dispatch: distinguish "never offered to you" from "you already passed",
    // so the rider app can show something truthful and drop the stale popup.
    const myOffers = (existing.dispatch?.offeredTo || []).filter(
      (entry) => String(entry?.partnerId) === String(deliveryPartnerId),
    );
    const isBarred = buildPartnerBarredPredicate(existing.dispatch?.offeredTo || [], dispatchConfig);
    if (isBarred(deliveryPartnerId)) {
      throw new ForbiddenError('You already passed on this order.');
    }
    if (myOffers.length === 0) {
      throw new ForbiddenError('This order was not offered to you.');
    }

    throw new ValidationError('Order is no longer available');
  }

  // This rider WON the atomic claim, so they — and only they — are authorised to
  // receive the customer's contact details. Every other surface (broadcast payload,
  // Firebase offer node, available-orders list) has them stripped.
  const responseOrder = sanitizeOrderForExternal(order, { includeCustomerContact: true });
  responseOrder.customerContact = {
    name:
      order.customerName ||
      order.deliveryAddress?.fullName ||
      order.deliveryAddress?.name ||
      order.userId?.name ||
      '',
    phone:
      order.customerPhone ||
      order.deliveryAddress?.phone ||
      order.userId?.phone ||
      '',
  };

  logger.info({
    event: 'ORDER_ACCEPTED',
    at: new Date().toISOString(),
    orderId: order._id.toString(),
    orderFriendlyId: order.order_id || order._id.toString(),
    acceptedBy: String(deliveryPartnerId),
    offeredRiderCount: (order.dispatch?.offeredTo || []).length,
    orderStatus: order.orderStatus,
  });

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${
          error?.message || error
        }`,
      );
    }

    try {
      const io = getIO();
      const db = getFirebaseDB();
      const offeredPartners = order.dispatch?.offeredTo || [];

      if (db) {
        for (const offer of offeredPartners) {
          const pid = offer.partnerId?.toString?.();
          if (pid) {
            db.ref(`delivery_offers/${pid}/${order._id.toString()}`).remove().catch(() => {});
          }
        }
      }

      if (io) {
        const payload = {
          orderMongoId: order._id?.toString?.(),
          orderId: order._id.toString(),
          orderStatus: order.orderStatus,
          dispatchStatus: order.dispatch?.status,
        };
        io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
        io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
        io.to(rooms.user(order.userId)).emit('order_status_update', payload);

        // Tell every OTHER offered rider to drop the popup immediately. The backend
        // is authoritative here: we do not rely on their local countdown expiring.
        //
        // Deduplicated because a rider can appear in offeredTo more than once across
        // re-offer rounds, and we must never emit to the winner.
        const winnerId = deliveryPartnerId.toString();
        const losingPartnerIds = new Set(
          offeredPartners
            .map((offer) => offer.partnerId?.toString?.())
            .filter((pid) => pid && pid !== winnerId),
        );

        const claimedPayload = {
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.(),
          orderFriendlyId: order.order_id || order._id.toString(),
          claimedBy: winnerId,
          reason: 'accepted_by_another_partner',
        };
        for (const pid of losingPartnerIds) {
          // `order_claimed` is what the rider app already listens for.
          io.to(rooms.delivery(pid)).emit('order_claimed', claimedPayload);
          // `offer_removed` is the explicit, self-describing name for the same
          // instruction; emitted alongside so newer clients can bind to it.
          io.to(rooms.delivery(pid)).emit('offer_removed', claimedPayload);
        }

        logger.info({
          event: 'ORDER_OFFER_REMOVED',
          at: new Date().toISOString(),
          orderId: order._id.toString(),
          acceptedBy: winnerId,
          notifiedRiderCount: losingPartnerIds.size,
          reason: 'accepted_by_another_partner',
        });
      }

      await notifyOwnersSafely(
        [
          { ownerType: 'USER', ownerId: order.userId },
          { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
          { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        ],
        {
          title: `Order ${order.order_id || order.orderId || order._id.toString()} accepted`,
          body: 'A delivery partner has accepted your order.',
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
          },
        },
      );
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${
          error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId, action = 'rejected') {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (!order.dispatch) {
    order.dispatch = { status: 'unassigned', offeredTo: [] };
  }
  if (!Array.isArray(order.dispatch.offeredTo)) {
    order.dispatch.offeredTo = [];
  }

  const safeAction = String(action).toLowerCase() === 'timeout' ? 'timeout' : 'rejected';
  const assignedToMe =
    order.dispatch.deliveryPartnerId?.toString() === deliveryPartnerId?.toString();

  const existingOffer = order.dispatch.offeredTo.find(
    (item) => String(item.partnerId) === String(deliveryPartnerId),
  );

  if (existingOffer) {
    existingOffer.action = safeAction;
    existingOffer.respondedAt = new Date();
  } else {
    order.dispatch.offeredTo.push({
      partnerId: deliveryPartnerId,
      action: safeAction,
      offeredAt: new Date(),
      respondedAt: new Date(),
    });
  }

  if (assignedToMe) {
    const fromStatus = order.dispatch.status || 'assigned';
    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = undefined;
    order.dispatch.assignedAt = undefined;
    order.dispatch.acceptedAt = undefined;
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromStatus,
      to: 'unassigned',
      note: safeAction === 'timeout' ? 'Offer timed out' : 'Rejected',
    });
  }
  await order.save();

  const db = getFirebaseDB();
  if (db) {
    db.ref(`delivery_offers/${deliveryPartnerId}/${order._id.toString()}`).remove().catch(() => {});
  }

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    action: safeAction,
  });

  void dispatchService
    .tryAutoAssign(order._id)
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return order.toObject();
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    return order.toObject();
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${
          restaurant?.restaurantName || 'your restaurant'
        } to pick up Order #${order.order_id || order.orderId || order._id.toString()}.`,
        data: {
          type: 'rider_arrived',
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${
        error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
  });
  return order.toObject();
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  order.orderStatus = nextStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'en_route_to_delivery',
    status: 'picked_up',
    pickedUpAt: new Date(),
    billImageUrl,
  };

  // Pre-generate handover OTP so user can see it as soon as food is on the way
  const existingOtp = String(order.deliveryOtp || '').trim();
  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || "").trim());

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
  });
  return order.toObject();
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return sanitizeOrderForExternal(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();
  if (!alreadyAtDrop || !existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return sanitizeOrderForExternal(order);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: sanitizeOrderForExternal(order) };
  }

  const otpStr = String(otp || '').trim();
  if (!otpStr) throw new ValidationError('OTP is required');

  if (!order.deliveryVerification?.dropOtp?.required) {
    throw new ValidationError(
      'OTP verification is not active for this order. Confirm reached drop first.',
    );
  }

  const expected = String(order.deliveryOtp || '').trim();
  if (!expected || expected !== otpStr) {
    throw new ValidationError(
      'Invalid OTP. Ask the customer for the code shown in their app.',
    );
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: sanitizeOrderForExternal(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const { otp, ratings } = body;
  logger.info(`[DeliveryComplete] Attempting to complete order ${order._id} for partner ${deliveryPartnerId}. Status: ${order.orderStatus}`);

  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'unpaid').toLowerCase();
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash').toLowerCase();
  const isCod = ['cash', 'cod', 'cash_on_delivery', 'razorpay_qr'].includes(payMethod);
  const otpRequired = order.deliveryVerification?.dropOtp?.required && !isCod;

  if (
    otp &&
    otpRequired &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    const expected = String(orderWithSecret?.deliveryOtp || '').trim();
    if (expected && expected === String(otp).trim()) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
      logger.info(`[DeliveryComplete] OTP verified during completion call for ${order._id}`);
    } else {
      throw new ValidationError('Invalid handover OTP provided.');
    }
  }

  if (
    otpRequired &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
      logger.warn(`[DeliveryComplete] Status advance check failed for ${order._id}. Current: ${from}`);
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }

  logger.info(`[DeliveryComplete] Order ${order._id} payment: ${payMethod}, status: ${prevPayStatus}`);

  if (['cash', 'cod', 'cash_on_delivery'].includes(payMethod)) {
    throw new ValidationError('Generate and verify the payment QR before completing this COD delivery');
  }

  if (payMethod === 'razorpay_qr') {
    const syncedPayment = await paymentService.syncRazorpayQrPayment(order);
    if (String(syncedPayment?.status || '').toLowerCase() !== 'paid') {
      throw new ValidationError('QR payment not verified yet');
    }
  }

  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: 'Delivery completed successfully',
  });

  await order.save();

  const ledgerKind =
    payMethod === 'cash' && prevPayStatus === 'cod_pending'
      ? 'cod_marked_paid_on_delivery'
      : 'payment_snapshot_sync';

  await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
    status: 'captured',
    recordedByRole: 'DELIVERY_PARTNER',
    recordedById: deliveryPartnerId,
    note: `Delivery completed. Prev status: ${prevPayStatus}`,
  });

  try {
    await userWalletService.awardCoinsForOrder(order.userId, order._id);
  } catch (err) {
    logger.warn(`completeDelivery award coins failed: ${err?.message || err}`);
  }

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    payMethod,
    prevPayStatus,
    paymentStatus: order.payment?.status,
  });
  return sanitizeOrderForExternal(order);
}

export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return order.toObject();
}
