import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { FoodCashbackSettings } from '../../admin/models/cashbackSettings.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';

/** Marks the wallet transactions that are order cashback. */
const CASHBACK_SOURCE = 'order_cashback';

const DEFAULTS = {
    isEnabled: false,
    cashbackType: 'percentage',
    cashbackValue: 0,
    minOrderValue: 0,
    maxCashback: 0
};

export const getCashbackSettings = async () => {
    const doc = await FoodCashbackSettings.findOne().lean();
    if (!doc) return { cashbackSettings: { ...DEFAULTS } };
    return {
        cashbackSettings: {
            isEnabled: doc.isEnabled === true,
            cashbackType: doc.cashbackType || 'percentage',
            cashbackValue: Number(doc.cashbackValue) || 0,
            minOrderValue: Number(doc.minOrderValue) || 0,
            maxCashback: Number(doc.maxCashback) || 0
        }
    };
};

export const updateCashbackSettings = async (payload = {}) => {
    const update = {};
    if (payload.isEnabled !== undefined) update.isEnabled = payload.isEnabled === true || payload.isEnabled === 'true';
    if (payload.cashbackType !== undefined) {
        const type = String(payload.cashbackType);
        if (!['percentage', 'flat'].includes(type)) throw new ValidationError('cashbackType must be percentage or flat');
        update.cashbackType = type;
    }
    for (const key of ['cashbackValue', 'minOrderValue', 'maxCashback']) {
        if (payload[key] === undefined) continue;
        const value = Number(payload[key]);
        if (!Number.isFinite(value) || value < 0) throw new ValidationError(`${key} must be a positive number`);
        update[key] = value;
    }

    await FoodCashbackSettings.findOneAndUpdate({}, { $set: update }, { upsert: true, new: true });
    return getCashbackSettings();
};

/**
 * Cashback earned on [orderTotal] under the current settings, or 0 when
 * cashback is off or the order is below the minimum.
 */
export const calculateCashback = (settings, orderTotal) => {
    const total = Number(orderTotal);
    if (!settings?.isEnabled || !Number.isFinite(total) || total <= 0) return 0;
    if (total < Number(settings.minOrderValue || 0)) return 0;

    const value = Number(settings.cashbackValue) || 0;
    if (value <= 0) return 0;

    const earned = settings.cashbackType === 'flat' ? value : (total * value) / 100;
    const cap = Number(settings.maxCashback) || 0;
    const capped = cap > 0 ? Math.min(earned, cap) : earned;
    return Number(capped.toFixed(2));
};

/**
 * Credits order cashback to the wallet. Called once, when an order is
 * delivered.
 *
 * Cashback lives in the wallet ledger rather than its own collection because it
 * *is* wallet money — a separate table would have to be kept in step with the
 * balance it represents. The `source` tag is what makes the history query
 * possible.
 *
 * Never throws: a delivery must not fail because cashback could not be issued.
 */
export const awardCashbackForOrder = async (userId, order) => {
    try {
        const id = String(userId || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return { awarded: 0 };

        const { cashbackSettings } = await getCashbackSettings();
        const amount = calculateCashback(cashbackSettings, order?.pricing?.total);
        if (amount <= 0) return { awarded: 0 };

        const orderId = String(order?._id || '');
        const oid = new mongoose.Types.ObjectId(id);

        // Idempotent: re-running the delivered hook must not pay twice.
        const already = await FoodUserWallet.exists({
            userId: oid,
            transactions: { $elemMatch: { 'metadata.source': CASHBACK_SOURCE, 'metadata.orderId': orderId } }
        });
        if (already) return { awarded: 0, reason: 'already_awarded' };

        const orderDisplayId = order?.order_id || order?.orderId || orderId;
        await FoodUserWallet.updateOne(
            { userId: oid },
            {
                $inc: { balance: amount },
                $push: {
                    transactions: {
                        $each: [{
                            type: 'addition',
                            amount,
                            status: 'Completed',
                            description: `Cashback for order #${orderDisplayId}`,
                            metadata: { source: CASHBACK_SOURCE, orderId, orderDisplayId }
                        }],
                        $position: 0
                    }
                },
                $setOnInsert: { userId: oid }
            },
            { upsert: true }
        );

        return { awarded: amount };
    } catch (error) {
        logger.warn(`awardCashbackForOrder failed: ${error?.message || error}`);
        return { awarded: 0, reason: 'error' };
    }
};

/** `GET /food/user/cashback` → `{ totalEarned, items, pagination }`. */
export const getCashbackHistory = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('User not found');

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);

    const wallet = await FoodUserWallet.findOne({ userId: new mongoose.Types.ObjectId(id) })
        .select('transactions')
        .lean();

    const entries = (wallet?.transactions || [])
        .filter((t) => t?.metadata?.source === CASHBACK_SOURCE)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalEarned = Number(
        entries.reduce((sum, t) => sum + (Number(t.amount) || 0), 0).toFixed(2)
    );

    const start = (page - 1) * limit;
    return {
        totalEarned,
        items: entries.slice(start, start + limit).map((t) => ({
            id: String(t._id),
            amount: Number(t.amount) || 0,
            description: t.description || '',
            orderId: t.metadata?.orderId || '',
            orderDisplayId: t.metadata?.orderDisplayId || '',
            status: t.status || 'Completed',
            date: t.createdAt,
            createdAt: t.createdAt
        })),
        pagination: {
            page,
            limit,
            total: entries.length,
            totalPages: Math.max(Math.ceil(entries.length / limit), 1)
        }
    };
};
