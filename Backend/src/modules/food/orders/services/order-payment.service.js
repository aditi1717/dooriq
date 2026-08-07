import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import {
  createRazorpayQrCode,
  fetchRazorpayQrCode,
  fetchRazorpayQrPayments,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import * as foodTransactionService from './foodTransaction.service.js';
import {
  buildOrderIdentityFilter,
  enqueueOrderEvent,
} from './order.helpers.js';

export async function syncRazorpayQrPayment(orderDoc) {
  const orderId = orderDoc?._id;
  // FoodTransaction is source of truth; FoodOrder.payment is fallback
  const tx = await FoodTransaction.findOne({ orderId }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) {
    logger.warn(`[QrSync] No payment found for order ${orderId}`);
    return null;
  }

  // Allow sync if either tx OR FoodOrder has razorpay_qr method
  const isQrMethod = payment.method === 'razorpay_qr';
  if (!isQrMethod) return payment;
  if (payment.status === 'paid') return payment;

  const qrId = payment?.qr?.qrId;
  if (!qrId) {
    logger.warn(`[QrSync] No qrId for order ${orderId}`);
    return payment;
  }
  if (!isRazorpayConfigured()) {
    logger.warn(`[QrSync] Razorpay not configured – cannot sync order ${orderId}`);
    return payment;
  }

  let qrCode;
  let qrPayments;
  try {
    [qrCode, qrPayments] = await Promise.all([
      fetchRazorpayQrCode(qrId),
      fetchRazorpayQrPayments(qrId, { count: 10 }),
    ]);
    logger.info(`[QrSync] Razorpay QR status for ${qrId}: ${qrCode?.status}`);
  } catch (error) {
    logger.error(
      `[QrSync] Razorpay QR fetch FAILED for ${qrId}: ${
        error?.message || error
      }`,
    );
    return payment;
  }

  const qrStatus = String(qrCode?.status || '').toLowerCase();
  if (!qrStatus) {
    logger.warn(`[QrSync] Empty qrStatus for ${qrId}`);
    return payment;
  }

  const latestPayment = Array.isArray(qrPayments?.items) ? qrPayments.items[0] : null;
  const latestPaymentStatus = String(latestPayment?.status || '').toLowerCase();
  const isPaid = ['paid', 'partially_paid', 'captured', 'authorized'].includes(latestPaymentStatus);
  const isFailed = ['expired', 'cancelled', 'canceled', 'failed', 'closed'].includes(qrStatus) && !isPaid;
  const newPaymentStatus = isPaid ? 'paid' : isFailed ? 'failed' : (payment.status || 'pending_qr');

  logger.info(`[QrSync] Updating order ${orderId} payment.status from '${payment.status}' to '${newPaymentStatus}'`);

  // Update FoodTransaction (upsert in case it didn't exist)
  await FoodTransaction.updateOne(
    { orderId },
    {
      $set: {
        'payment.qr.status': qrStatus,
        'payment.qr.latestPaymentId': latestPayment?.id || '',
        'payment.qr.latestPaymentStatus': latestPaymentStatus || '',
        'payment.status': newPaymentStatus,
      },
    },
  );

  // Keep FoodOrder in sync too
  if (isPaid) {
    await FoodOrder.updateOne(
      { _id: orderId },
      { $set: { 'payment.status': 'paid', 'payment.qr.status': qrStatus } }
    );
  }

  const updatedTx = await FoodTransaction.findOne({ orderId }).lean();
  return updatedTx?.payment || payment;
}



export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: orderId }
    : { orderId };

  const order = await FoodOrder.findOne(query)
    .populate('userId', 'name email phone')
    .lean();

  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const payment = tx?.payment || order.payment || {};
  if (payment.method !== 'cash' && payment.status === 'paid') {
    throw new ValidationError('Order already paid');
  }

  const amountDue = payment.amountDue ?? tx?.pricing?.total ?? order.pricing?.total ?? 0;
  if (amountDue < 1) throw new ValidationError('No amount due');
  if (!isRazorpayConfigured()) {
    throw new ValidationError('QR payment not configured');
  }

  const user = order.userId || {};
  const qr = await createRazorpayQrCode({
    amountPaise: Math.round(amountDue * 100),
    name: `Order ${order._id.toString().slice(-6)} Collect`,
    description: `Order ${order._id.toString()} - COD collect`,
  });


  // CRITICAL: use upsert so this works even if FoodTransaction was never created at order placement
  const upsertData = {
    $set: {
      paymentMethod: 'razorpay_qr',
      'payment.method': 'razorpay_qr',
      'payment.status': 'pending_qr',
      'payment.amountDue': amountDue,
      'payment.qr': {
        qrId: qr.id,
        shortUrl: qr.image_url || '',
        imageUrl: qr.image_url || '',
        imageContent: qr.image_content || '',
        status: qr.status || 'active',
        expiresAt: qr.closed_at ? new Date(qr.closed_at * 1000) : null,
      },
    },
    $setOnInsert: {
      orderId: order._id,
      userId: order.userId?._id || order.userId,
      restaurantId: order.restaurantId,
      deliveryPartnerId: order.dispatch?.deliveryPartnerId,
      currency: 'INR',
      status: 'pending',
      pricing: {
        subtotal: order.pricing?.subtotal || 0,
        tax: order.pricing?.tax || 0,
        packagingFee: order.pricing?.packagingFee || 0,
        deliveryFee: order.pricing?.deliveryFee || 0,
        platformFee: order.pricing?.platformFee || 0,
        restaurantCommission: order.pricing?.restaurantCommission || 0,
        discount: order.pricing?.discount || 0,
        couponCode: order.pricing?.couponCode ? String(order.pricing.couponCode).trim().toUpperCase() : null,
        total: order.pricing?.total || 0,
        currency: 'INR',
      },
      amounts: {
        totalCustomerPaid: order.pricing?.total || 0,
        restaurantShare: 0, riderShare: 0, restaurantCommission: 0, platformNetProfit: 0,
      },
      history: [{ kind: 'created', amount: amountDue, note: 'Transaction auto-created at QR generation' }],
    },
  };

  await FoodTransaction.updateOne(
    { orderId: order._id },
    upsertData,
    { upsert: true }
  );

  // Also write to FoodOrder so sync can find the QR id even without a TX doc
  await FoodOrder.updateOne(
    { _id: order._id },
    {
      $set: {
        'payment.method': 'razorpay_qr',
        'payment.status': 'pending_qr',
        'payment.qr.qrId': qr.id,
        'payment.qr.shortUrl': qr.image_url || '',
        'payment.qr.imageUrl': qr.image_url || '',
        'payment.qr.imageContent': qr.image_content || '',
        'payment.qr.status': qr.status || 'active',
      }
    }
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: order._id }).lean();


  if (updatedTx) {
    await foodTransactionService.updateTransactionStatus(
      order._id,
      'cod_collect_qr_created',
      {
        recordedByRole: 'DELIVERY_PARTNER',
        recordedById: deliveryPartnerId,
        note: 'COD collection QR created',
      },
    );
  }

  enqueueOrderEvent('collect_qr_created', {
    orderMongoId: String(orderId),
    orderId: order?.orderId || null,
    deliveryPartnerId,
    qrId: qr.id,
    shortUrl: qr.image_url || '',
    amountDue,
  });

  return {
    imageUrl:
      qr?.image_url ?? qr?.imageUrl ?? null,
    imageContent: qr?.image_content ?? qr?.imageContent ?? null,
    qrId: qr?.id ?? null,
    amount: amountDue,
    expiresAt: qr?.closed_at
      ? new Date(qr.closed_at * 1000)
      : null,
  };
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  // Include payment field so syncRazorpayQrPayment can use it as fallback
  const order = await FoodOrder.findOne(identity).select(
    'dispatch riderEarning platformProfit payment',
  );
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  let transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const effectiveMethod = transaction?.payment?.method || order.payment?.method;
  const hasQrCode = transaction?.payment?.qr?.qrId || order.payment?.qr?.qrId;
  
  logger.info(`[getPaymentStatus] order=${order._id} method=${effectiveMethod} txStatus=${transaction?.payment?.status} hasQr=${!!hasQrCode}`);

  // Sync if this is a QR payment (check both tx and order) and not already paid
  if (effectiveMethod === 'razorpay_qr' && transaction?.payment?.status !== 'paid' && hasQrCode) {
    await syncRazorpayQrPayment(order);
    // Re-fetch to get the latest status after sync
    transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
    logger.info(`[getPaymentStatus] After sync: tx.payment.status=${transaction?.payment?.status}`);
  }

  // If no transaction, fall back to FoodOrder.payment
  const paymentData = transaction?.payment || order.payment?.toObject?.() || {};

  const latestHistory =
    (transaction?.history || []).sort((a, b) => (b.at || 0) - (a.at || 0))[0] ||
    null;

  return {
    payment: paymentData,
    latestPaymentSnapshot: latestHistory,
    riderEarning: order.riderEarning ?? 0,
    platformProfit: order.platformProfit ?? 0,
    pricingTotal: transaction?.pricing?.total ?? 0,
    transactionStatus: transaction?.status ?? null,
  };
}



export async function switchToCash(orderId, deliveryPartnerId) {
  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: orderId }
    : { orderId };

  const order = await FoodOrder.findOne(query).lean();
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  // Reset payment method to cash in FoodTransaction
  await FoodTransaction.updateOne(
    { orderId: order._id },
    {
      $set: {
        paymentMethod: 'cash',
        'payment.method': 'cash',
        'payment.status': 'cod_pending',
        'payment.qr': {} // Clear QR info
      }
    }
  );

  await foodTransactionService.updateTransactionStatus(
    order._id,
    'cod_switched_to_cash',
    {
      recordedByRole: 'DELIVERY_PARTNER',
      recordedById: deliveryPartnerId,
      note: 'Rider switched from QR to Cash collection',
    }
  );

  return { success: true };
}
