import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FEATURE_KEYS, isFeatureEnabled } from '../../admin/services/featureSettings.service.js';
import { attemptAutoSettleSubscriptionDue } from './subscriptionPlan.service.js';

function toTwoDigitYearString(dateObj) {
    const y = String(dateObj.getFullYear());
    return y.slice(-2);
}

function monthShort(monthIndex) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthIndex] || 'Jan';
}

function getFixedCurrentCycleWindow(now = new Date()) {
    const startDay = 15;
    
    let year = now.getFullYear();
    let month = now.getMonth();

    // If before start day, settlement belongs to previous month cycle.
    if (now.getDate() < startDay) {
        month = month - 1;
        if (month < 0) {
            month = 11;
            year -= 1;
        }
    }

    const start = new Date(year, month, startDay, 0, 0, 0, 0);
    // End should be either fixed 21 or now, let's make it more inclusive for "Current Cycle"
    // Users want to see their active earnings, so we extend it to 'now'
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return {
        start,
        end,
        startMeta: { day: String(startDay), month: monthShort(month), year: toTwoDigitYearString(new Date(year, month, startDay)) },
        endMeta: { day: String(now.getDate()), month: monthShort(now.getMonth()), year: toTwoDigitYearString(now) }
    };
}

function parseISODateParam(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseISODateParamEnd(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
}

function calculateOfferDiscount(offer, subtotal) {
    const safeSubtotal = Math.max(0, Number(subtotal) || 0);
    if (!offer || safeSubtotal <= 0) return 0;
    if (offer.discountType === 'percentage') {
        const raw = safeSubtotal * ((Number(offer.discountValue) || 0) / 100);
        const capped = Number(offer.maxDiscount) ? Math.min(raw, Number(offer.maxDiscount)) : raw;
        return Math.max(0, Math.min(safeSubtotal, Math.floor(capped)));
    }
    return Math.max(0, Math.min(safeSubtotal, Math.floor(Number(offer.discountValue) || 0)));
}

function offerMatchesRestaurant(offer, restaurantId) {
    if (!offer || offer.restaurantScope !== 'selected') return true;
    const ids = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0
        ? offer.restaurantIds
        : [offer.restaurantId].filter(Boolean);
    return ids.some((id) => String(id) === String(restaurantId));
}

function resolveDiscountSplit({ order, pricing, amounts, offers, restaurantId }) {
    const discount = Number(pricing?.discount) || 0;
    const savedAdminShare = Number(amounts?.adminDiscountShare) || 0;
    const savedRestaurantShare = Number(amounts?.restaurantDiscountShare) || 0;
    if (discount <= 0) {
        return { adminDiscountShare: 0, restaurantDiscountShare: 0, adminBearPercentage: 0, restaurantBearPercentage: 0 };
    }
    if (savedAdminShare > 0 || savedRestaurantShare > 0) {
        return {
            adminDiscountShare: savedAdminShare,
            restaurantDiscountShare: savedRestaurantShare,
            adminBearPercentage: Number(amounts?.discountAdminBearPercentage) || 0,
            restaurantBearPercentage: Number(amounts?.discountRestaurantBearPercentage) || 0
        };
    }

    const couponCode = String(pricing?.couponCode || order?.pricing?.couponCode || '').trim().toUpperCase();
    const subtotal = Number(pricing?.subtotal) || 0;
    const scopedOffers = (offers || []).filter((offer) => offerMatchesRestaurant(offer, restaurantId));
    const matchedByCode = couponCode
        ? scopedOffers.find((offer) => String(offer?.couponCode || '').trim().toUpperCase() === couponCode)
        : null;
    const matchingOffers = matchedByCode
        ? [matchedByCode]
        : scopedOffers.filter((offer) => calculateOfferDiscount(offer, subtotal) === discount);

    if (matchingOffers.length !== 1) {
        return { adminDiscountShare: discount, restaurantDiscountShare: 0, adminBearPercentage: 100, restaurantBearPercentage: 0 };
    }

    const offer = matchingOffers[0];
    const adminPct = Math.max(0, Math.min(100, Number(offer.adminBearPercentage ?? (offer.createdByRole === 'RESTAURANT' ? 0 : 100)) || 0));
    const restaurantPct = Math.max(0, Math.min(100, Number(offer.restaurantBearPercentage ?? (offer.createdByRole === 'RESTAURANT' ? 100 : 0)) || 0));
    const totalPct = adminPct + restaurantPct;
    const adminBearPercentage = totalPct > 0 ? (adminPct / totalPct) * 100 : 100;
    const restaurantBearPercentage = totalPct > 0 ? (restaurantPct / totalPct) * 100 : 0;
    const restaurantDiscountShare = Math.round(discount * (restaurantBearPercentage / 100) * 100) / 100;
    const adminDiscountShare = Math.max(0, Math.round((discount - restaurantDiscountShare) * 100) / 100);
    return { adminDiscountShare, restaurantDiscountShare, adminBearPercentage, restaurantBearPercentage };
}

function isEarnedOrder(order) {
    const orderStatus = String(order?.orderStatus || '').trim().toLowerCase();
    const deliveryPhase = String(order?.deliveryState?.currentPhase || '').trim().toLowerCase();
    return (
        orderStatus === 'delivered' ||
        deliveryPhase === 'delivered' ||
        deliveryPhase === 'completed'
    );
}

export async function getRestaurantFinance(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    const rid = new mongoose.Types.ObjectId(restaurantId);
    const isRestaurantSubscriptionEnabled = await isFeatureEnabled(FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, true);
    if (isRestaurantSubscriptionEnabled) {
        await attemptAutoSettleSubscriptionDue(restaurantId).catch(() => null);
    }

    // Fetch restaurant profile for header display.
    const restaurant = await FoodRestaurant.findById(rid)
        .select('restaurantName addressLine1 addressLine2 area city state pincode location subscriptionDueAmount subscriptionStatus subscriptionAutoDeductedAmount')
        .lean();

    const address =
        restaurant?.location?.formattedAddress ||
        (restaurant?.addressLine1
            ? [restaurant.addressLine1, restaurant.addressLine2, restaurant.area].filter(Boolean).join(', ')
            : restaurant?.addressLine1 || '');

    const nowWindow = getFixedCurrentCycleWindow(new Date());

    const scopedOfferFilter = {
        $or: [
            { restaurantScope: { $ne: 'selected' } },
            { restaurantId: rid },
            { restaurantIds: rid }
        ]
    };

    const [currentOrders, relevantOffers] = await Promise.all([
        FoodOrder.find({
            restaurantId: rid,
            orderStatus: { $nin: ['pending_payment'] },
            createdAt: { $gte: nowWindow.start, $lte: nowWindow.end }
        })
            .populate('transactionId')
            .sort({ createdAt: -1 })
            .lean(),
        FoodOffer.find(scopedOfferFilter).lean()
    ]);

    const mapFinanceOrder = (order) => {
        const tx = order.transactionId || {};
        const items = Array.isArray(order.items) ? order.items : [];
        const foodNames = items.map((it) => it?.name).filter(Boolean).join(', ');
        
        // Use pricing from transaction if available, fallback to order pricing.
        const pricing = tx.pricing || order.pricing || {};
        const amounts = tx.amounts || {};
        
        const subtotal = Number(pricing.subtotal) || 0;
        const packagingFee = Number(pricing.packagingFee) || 0;
        const commission = Number(amounts.restaurantCommission) || Number(pricing.restaurantCommission) || 0;
        const discount = Number(pricing.discount) || 0;
        const discountSplit = resolveDiscountSplit({ order, pricing, amounts, offers: relevantOffers, restaurantId: rid });
        const adminDiscountShare = discountSplit.adminDiscountShare;
        const restaurantDiscountShare = discountSplit.restaurantDiscountShare;
        
        const payout = isEarnedOrder(order)
            ? subtotal + packagingFee - commission - restaurantDiscountShare
            : 0;

        return {
            orderId: order.orderId || order.order_id || `FOD-${order._id.toString().slice(-6).toUpperCase()}`,
            createdAt: order.createdAt,
            items,
            foodNames,
            orderTotal: Math.max(0, (Number(pricing.total) || 0) - (Number(pricing.tax) || 0)),
            totalAmount: Number(pricing.total) || 0,
            payout: Math.max(0, payout),
            commission: commission,
            discount,
            adminDiscountShare,
            restaurantDiscountShare,
            discountAdminBearPercentage: discountSplit.adminBearPercentage,
            discountRestaurantBearPercentage: discountSplit.restaurantBearPercentage,
            paymentMethod: tx.paymentMethod || order.payment?.method || 'cash',
            orderStatus: order.orderStatus,
            status: tx.status || (order.payment?.status === 'paid' ? 'captured' : 'pending')
        };
    };

    const currentCycleOrders = currentOrders.map(mapFinanceOrder);

    const currentCycleEstimatedPayout = currentCycleOrders.reduce(
        (sum, o) => sum + (Number(o.payout) || 0),
        0
    );

    // Block only pending withdrawals from available balance.
    // Approved/rejected requests are processed records and should not keep locking payout.
    const pendingWithdrawalsAgg = await FoodRestaurantWithdrawal.aggregate([
        {
            $match: {
                restaurantId: rid,
                $expr: {
                    $eq: [{ $toLower: { $trim: { input: '$status' } } }, 'pending']
                }
            }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalPendingWithdrawals = Number(pendingWithdrawalsAgg?.[0]?.total || 0);
    const subscriptionDue = isRestaurantSubscriptionEnabled
        ? Math.max(0, Number(restaurant?.subscriptionDueAmount || 0))
        : 0;
    // Calculate final balance for withdrawal.
    // NOTE: We no longer automatically deduct subscriptionDue here per user request ("direct deduct na ho").
    // We will instead block the withdrawal in the controller if subscriptionDue > 0.
    const subscriptionReserved = Math.max(0, Number(restaurant?.subscriptionAutoDeductedAmount || 0));
    const availableBalance = Math.max(0, currentCycleEstimatedPayout - totalPendingWithdrawals - subscriptionReserved);

    const currentCycle = {
        start: { ...nowWindow.startMeta },
        end: { ...nowWindow.endMeta },
        totalEarnings: currentCycleEstimatedPayout, // We still show current cycle earnings label
        totalWithdrawn: totalPendingWithdrawals,
        estimatedPayout: currentCycleEstimatedPayout,
        withdrawableBalance: availableBalance,
        netAvailable: Math.max(0, availableBalance - subscriptionDue), // Net amount that is ACTUALLY withdrawable
        totalOrders: currentCycleOrders.length,
        payoutDate: null,
        orders: currentCycleOrders
    };

    // Invoice Summary (derived from current cycle or broader if needed)
    const invoiceSummary = {
        count: currentCycleOrders.length,
        subtotal: currentCycleOrders.reduce((sum, o) => sum + (Number(o.orderTotal) || 0), 0),
        taxes: currentCycleOrders.reduce((sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.orderTotal) || 0)), 0),
        gross: currentCycleOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
    };

    // Past cycles: build from provided startDate/endDate query.
    const startDate = parseISODateParam(query.startDate);
    const endDate = parseISODateParamEnd(query.endDate);

    let pastCyclesResult = { orders: [], totalOrders: 0 };
    if (startDate && endDate) {
        const pastOrders = await FoodOrder.find({
            restaurantId: rid,
            orderStatus: { $nin: ['pending_payment'] },
            createdAt: { $gte: startDate, $lte: endDate }
        })
            .populate('transactionId')
            .sort({ createdAt: -1 })
            .lean();

        const pastCycleOrders = pastOrders.map(mapFinanceOrder);

        pastCyclesResult = {
            orders: pastCycleOrders,
            totalOrders: pastCycleOrders.length
        };
    }

    return {
        restaurant: {
            name: restaurant?.restaurantName || '',
            restaurantId: restaurant?._id ? `REST${restaurant._id.toString().slice(-6).padStart(6, '0')}` : 'N/A',
            address,
            subscriptionDueAmount: Number(restaurant?.subscriptionDueAmount || 0),
            subscriptionStatus: restaurant?.subscriptionStatus || 'paid'
        },
        features: {
            restaurantSubscriptionEnabled: isRestaurantSubscriptionEnabled
        },
        currentCycle,
        invoiceSummary,
        pastCycles: pastCyclesResult
    };
}
