import crypto from 'crypto';
import mongoose from 'mongoose';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { FoodTransaction } from '../../../modules/food/orders/models/foodTransaction.model.js';
import * as foodTransactionService from '../../../modules/food/orders/services/foodTransaction.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

const toPaise = (amount) => Math.round(Number(amount || 0) * 100);

async function markQrOrderPaidFromPayment(paymentObj = {}) {
    const rzPaymentId = paymentObj.id;
    const qrId =
        paymentObj.qr_code_id ||
        paymentObj.qrCodeId ||
        paymentObj.notes?.qrId ||
        paymentObj.notes?.qr_id ||
        '';
    const notedOrderId = paymentObj.notes?.orderMongoId || paymentObj.notes?.orderId || '';

    const identity = [];
    if (qrId) {
        identity.push({ 'payment.qr.qrId': qrId }, { 'payment.qr.paymentLinkId': qrId });
    }
    if (notedOrderId && mongoose.Types.ObjectId.isValid(notedOrderId)) {
        identity.push({ _id: new mongoose.Types.ObjectId(notedOrderId) });
    }
    if (notedOrderId) {
        identity.push({ orderId: String(notedOrderId) });
    }
    if (identity.length === 0) return null;

    const existingOrder = await FoodOrder.findOne({
        $or: identity,
        'payment.status': { $ne: 'paid' },
    }).lean();
    if (!existingOrder) return null;

    const expectedAmountPaise = toPaise(
        existingOrder.payment?.amountDue ||
        existingOrder.payment?.qr?.amount ||
        existingOrder.pricing?.total ||
        0,
    );
    const receivedAmountPaise = Number(paymentObj.amount || 0);
    const isCaptured = String(paymentObj.status || '').toLowerCase() === 'captured';
    if (!isCaptured || receivedAmountPaise < expectedAmountPaise) {
        logger.warn(
            `Webhook [payment.captured]: Ignored QR payment ${rzPaymentId}; captured=${isCaptured}, received=${receivedAmountPaise}, expected=${expectedAmountPaise}`,
        );
        return null;
    }

    const order = await FoodOrder.findOneAndUpdate(
        {
            _id: existingOrder._id,
            'payment.status': { $ne: 'paid' },
        },
        {
            $set: {
                'payment.method': 'razorpay_qr',
                'payment.status': 'paid',
                'payment.razorpay.paymentId': rzPaymentId,
                'payment.qr.status': 'paid',
                ...(qrId ? { 'payment.qr.qrId': qrId, 'payment.qr.paymentLinkId': qrId } : {}),
            },
        },
        { new: true },
    );

    if (!order) return null;

    await FoodTransaction.updateOne(
        { orderId: order._id },
        {
            $set: {
                paymentMethod: 'razorpay_qr',
                status: 'captured',
                'payment.method': 'razorpay_qr',
                'payment.status': 'paid',
                'payment.razorpay.paymentId': rzPaymentId,
                'payment.qr.status': 'paid',
                ...(qrId ? { 'payment.qr.qrId': qrId, 'payment.qr.paymentLinkId': qrId } : {}),
                'gateway.razorpayPaymentId': rzPaymentId,
            },
        },
    );

    try {
        await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
            status: 'captured',
            razorpayPaymentId: rzPaymentId,
            note: 'COD QR payment verified via Razorpay webhook',
        });
    } catch (ledgerErr) {
        logger.error(`Webhook QR Ledger Error (Order ${order.orderId}): ${ledgerErr.message}`);
    }

    return order;
}

/**
 * ✅ NEW: Centralized Razorpay Webhook Handler (Core Layer)
 * Manages atomic updates for order payments and refunds across all modules.
 */
export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpayWebhookSecret;

    // 1. Verify Signature using raw body buffer
    if (!signature || !secret || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing signature or rawBody buffer.');
        return res.status(400).send('Invalid signature');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    if (expected !== signature) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
    logger.info(`Razorpay Webhook Received: ${event}`);

    try {
        // --- 🟢 Handle Payment Captured (Success) ---
        if (event === 'payment.captured') {
            const paymentObj = payload.payment.entity;
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;

            const qrOrder = await markQrOrderPaidFromPayment(paymentObj);
            if (qrOrder) {
                logger.info(`Webhook [payment.captured]: Synced COD QR Order ${qrOrder.orderId} (Status=paid)`);
                return res.status(200).json({ status: 'ok' });
            }

            // Atomic update to mark as paid if not already
            const order = await FoodOrder.findOneAndUpdate(
                { 
                    "payment.razorpay.orderId": rzOrderId, 
                    "payment.status": { $ne: 'paid' } 
                },
                { 
                    $set: { 
                        "payment.status": 'paid', 
                        "payment.razorpay.paymentId": rzPaymentId 
                    } 
                },
                { new: true }
            );

            if (order) {
                // ✅ UPDATED: Wrapped in try-catch to prevent secondary failures from breaking the webhook response
                try {
                    await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
                        status: 'captured',
                        razorpayPaymentId: rzPaymentId,
                        note: 'Payment status synced via Webhook (payment.captured)'
                    });
                } catch (ledgerErr) {
                    logger.error(`Webhook Ledger Error (Order ${order.orderId}): ${ledgerErr.message}`);
                }
                logger.info(`Webhook [payment.captured]: Synced Order ${order.orderId} (Status=paid)`);
            } else {
                // ✅ ADDED: Log warn if order not found but payment was captured
                logger.warn(`Webhook [payment.captured]: Order not found or already paid for RZ-Order: ${rzOrderId}`);
            }
        }

        // --- 🔴 Handle Refund Processed ---
        if (event === 'refund.processed') {
            const refundObj = payload.refund.entity;
            const rzPaymentId = refundObj.payment_id;
            const rzRefundId = refundObj.id;
            const refundAmount = refundObj.amount / 100; // to major unit

            // Sync refund fields in the order
            const order = await FoodOrder.findOneAndUpdate(
                { 
                    "payment.razorpay.paymentId": rzPaymentId,
                    "payment.refund.status": { $ne: 'processed' }
                },
                { 
                    $set: { 
                        "payment.status": 'refunded',
                        "payment.refund": {
                            status: 'processed',
                            amount: refundAmount,
                            refundId: rzRefundId,
                            processedAt: new Date()
                        }
                    } 
                },
                { new: true }
            );

            if (order) {
                logger.info(`Webhook [refund.processed]: Synced Order ${order.orderId} (Refunded)`);
            } else {
                // ✅ ADDED: Log warn if order not found for refund
                logger.warn(`Webhook [refund.processed]: Order not found or already refunded for RZ-Payment: ${rzPaymentId}`);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
