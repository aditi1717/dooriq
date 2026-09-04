import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Refund } from '../../../../core/payments/models/refund.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';

/**
 * `GET /food/user/refunds` → `{ totalRefunded, refunds, pagination }`.
 *
 * `totalRefunded` counts processed refunds only — a pending one has not reached
 * the user's money yet, and showing it in the headline total would overstate
 * what they have actually been given back.
 */
export const getRefundHistory = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('User not found');

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const filter = { userId: new mongoose.Types.ObjectId(id) };

    const [rows, total, processedTotals] = await Promise.all([
        Refund.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Refund.countDocuments(filter),
        Refund.aggregate([
            { $match: { ...filter, status: 'processed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
    ]);

    // Order + restaurant names are joined for the page in one round trip each,
    // rather than per row.
    const orders = rows.length
        ? await FoodOrder.find({ _id: { $in: rows.map((r) => r.orderId) } })
            .select('order_id restaurantId')
            .lean()
        : [];
    const orderMap = new Map(orders.map((o) => [String(o._id), o]));

    const restaurantIds = [...new Set(orders.map((o) => String(o.restaurantId || '')).filter(Boolean))];
    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName || '']));

    return {
        totalRefunded: Number((processedTotals[0]?.total || 0).toFixed(2)),
        refunds: rows.map((refund) => {
            const order = orderMap.get(String(refund.orderId));
            return {
                id: String(refund._id),
                orderId: String(refund.orderId || ''),
                orderDisplayId: order?.order_id || '',
                restaurantName: restaurantMap.get(String(order?.restaurantId || '')) || '',
                amount: Number(refund.amount) || 0,
                status: refund.status || 'pending',
                method: refund.refundTo || '',
                refundId: refund.gatewayRefundId || '',
                reason: refund.reason || '',
                creditedToWallet: refund.refundTo === 'wallet',
                processedAt: refund.processedAt || null,
                createdAt: refund.createdAt
            };
        }),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1)
        }
    };
};
