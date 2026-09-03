import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserPayLater } from '../models/userPayLater.model.js';
import { FoodBusinessSettings } from '../../admin/models/businessSettings.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { deductWalletBalance } from './userWallet.service.js';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature
} from '../../orders/helpers/razorpay.helper.js';

const toUserId = (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    return new mongoose.Types.ObjectId(id);
};

const ensureAccount = async (uid) => {
    const existing = await FoodUserPayLater.findOne({ userId: uid });
    if (existing) return existing;
    return FoodUserPayLater.create({ userId: uid, amountDue: 0, entries: [] });
};

const readSettings = async () => {
    const settings = await FoodBusinessSettings.findOne().select('payLaterSettings').lean();
    const raw = settings?.payLaterSettings || {};
    return {
        isEnabled: raw.isEnabled === true,
        minDeliveredOrders: Number(raw.minDeliveredOrders) || 0,
        creditLimit: Number(raw.creditLimit) || 0
    };
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

/**
 * `GET /food/user/pay-later` → `{ payLater: { eligible, limit, amountDue, availableCredit } }`.
 *
 * A user who already owes money stays eligible even if they later fall below
 * the order threshold — otherwise the repay screen would vanish while a
 * balance was still outstanding.
 */
export const getPayLaterAccount = async (userId) => {
    const uid = toUserId(userId);
    const [settings, account] = await Promise.all([
        readSettings(),
        FoodUserPayLater.findOne({ userId: uid }).lean()
    ]);

    const amountDue = round2(account?.amountDue);

    if (!settings.isEnabled || account?.isBlocked) {
        return { payLater: { eligible: false, limit: 0, amountDue, availableCredit: 0 } };
    }

    const deliveredOrders = await FoodOrder.countDocuments({ userId: uid, orderStatus: 'delivered' });
    const eligible = deliveredOrders >= settings.minDeliveredOrders || amountDue > 0;
    const limit = eligible ? settings.creditLimit : 0;

    return {
        payLater: {
            eligible,
            limit: round2(limit),
            amountDue,
            availableCredit: round2(Math.max(0, limit - amountDue))
        }
    };
};

/**
 * Adds an order to the user's Pay Later balance. Throws when the order does not
 * fit in the remaining credit, which aborts order creation.
 */
export const chargePayLater = async (userId, order) => {
    const amount = round2(order?.pricing?.total);
    if (amount <= 0) throw new ValidationError('Invalid order amount');

    const { payLater } = await getPayLaterAccount(userId);
    if (!payLater.eligible) throw new ValidationError('Pay Later is not available for your account');
    if (amount > payLater.availableCredit) {
        throw new ValidationError(`Pay Later limit exceeded. Available credit: ₹${payLater.availableCredit.toFixed(2)}`);
    }

    const uid = toUserId(userId);
    const orderId = String(order?._id || '');
    const orderDisplayId = order?.order_id || order?.orderId || orderId;

    await ensureAccount(uid);
    await FoodUserPayLater.updateOne(
        { userId: uid },
        {
            $inc: { amountDue: amount },
            $push: {
                entries: {
                    $each: [{
                        type: 'charge',
                        amount,
                        orderId,
                        orderDisplayId,
                        description: `Order #${orderDisplayId}`
                    }],
                    $position: 0
                }
            }
        }
    );

    return getPayLaterAccount(userId);
};

/**
 * Reverses a Pay Later charge — used when an order is cancelled or refunded.
 * Never throws: a refund must not fail because the ledger was already clear.
 */
export const releasePayLaterCharge = async (userId, order) => {
    const amount = round2(order?.pricing?.total);
    if (amount <= 0) return { released: 0 };

    const uid = toUserId(userId);
    const account = await FoodUserPayLater.findOne({ userId: uid });
    if (!account) return { released: 0 };

    const orderId = String(order?._id || '');
    const alreadyReleased = (account.entries || []).some(
        (e) => e.type === 'repayment' && e.orderId === orderId
    );
    if (alreadyReleased) return { released: 0 };

    const release = Math.min(amount, round2(account.amountDue));
    if (release <= 0) return { released: 0 };

    account.amountDue = round2(account.amountDue - release);
    account.entries.unshift({
        type: 'repayment',
        amount: release,
        orderId,
        orderDisplayId: order?.order_id || order?.orderId || orderId,
        description: `Reversal for order #${order?.order_id || orderId}`
    });
    await account.save();

    return { released: release };
};

const settleDue = async (uid, amount, description) => {
    const account = await ensureAccount(uid);
    account.amountDue = round2(Math.max(0, Number(account.amountDue || 0) - amount));
    account.entries.unshift({ type: 'repayment', amount, description });
    await account.save();
};

/** `POST /food/user/pay-later/repay/wallet`. */
export const repayFromWallet = async (userId) => {
    const uid = toUserId(userId);
    const { payLater } = await getPayLaterAccount(userId);
    if (payLater.amountDue <= 0) throw new ValidationError('You have no Pay Later dues');

    // Debits the wallet first: a failed debit (insufficient balance) throws
    // before the ledger is touched, so the due can never be cleared unpaid.
    await deductWalletBalance(userId, payLater.amountDue, 'Pay Later repayment', { source: 'pay_later_repayment' });
    await settleDue(uid, payLater.amountDue, 'Repaid from wallet');

    return getPayLaterAccount(userId);
};

/** `POST /food/user/pay-later/repay/razorpay/start` → `{ key, orderId, amount, currency }`. */
export const startRazorpayRepayment = async (userId) => {
    const { payLater } = await getPayLaterAccount(userId);
    if (payLater.amountDue <= 0) throw new ValidationError('You have no Pay Later dues');

    const amountPaise = Math.round(payLater.amountDue * 100);
    if (amountPaise < 100) throw new ValidationError('Amount too low for online payment');

    if (!isRazorpayConfigured()) {
        return {
            key: getRazorpayKeyId() || 'rzp_test_dummy',
            orderId: `order_dev_${Date.now()}`,
            amount: amountPaise,
            currency: 'INR'
        };
    }

    const receipt = `paylater_${String(userId).slice(-8)}_${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);
    return {
        key: getRazorpayKeyId(),
        orderId: String(order.id),
        amount: Number(order.amount) || amountPaise,
        currency: order.currency || 'INR'
    };
};

/** `POST /food/user/pay-later/repay/razorpay/verify`. */
export const verifyRazorpayRepayment = async (userId, payload = {}) => {
    const orderId = String(payload.razorpayOrderId || '').trim();
    const paymentId = String(payload.razorpayPaymentId || '').trim();
    const signature = String(payload.razorpaySignature || '').trim();

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');

    const uid = toUserId(userId);
    const account = await ensureAccount(uid);

    // Idempotent: a retried verify for a payment already settled returns the
    // account untouched rather than clearing a second, unrelated due.
    if ((account.entries || []).some((e) => e.description === `Repaid online (${orderId})`)) {
        return getPayLaterAccount(userId);
    }

    if (isRazorpayConfigured() && !verifyPaymentSignature(orderId, paymentId, signature)) {
        throw new ValidationError('Payment verification failed');
    }

    const { payLater } = await getPayLaterAccount(userId);
    if (payLater.amountDue <= 0) return getPayLaterAccount(userId);

    await settleDue(uid, payLater.amountDue, `Repaid online (${orderId})`);
    return getPayLaterAccount(userId);
};
