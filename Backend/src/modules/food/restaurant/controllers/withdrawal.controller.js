import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import { FEATURE_KEYS, isFeatureEnabled } from '../../admin/services/featureSettings.service.js';
import { attemptAutoSettleSubscriptionDue } from '../services/subscriptionPlan.service.js';

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { amount, bankDetails } = req.body;

        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');
        if (!amount || amount <= 0) return sendError(res, 400, 'Invalid withdrawal amount');

        await attemptAutoSettleSubscriptionDue(restaurantId).catch(() => null);

        // Check if restaurant has enough balance
        const finance = await getRestaurantFinance(restaurantId);
        const restaurant = await FoodRestaurant.findById(restaurantId).select('subscriptionStatus subscriptionDueAmount');
        const isRestaurantSubscriptionEnabled = await isFeatureEnabled(FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, true);

        const subscriptionDue = Number(restaurant?.subscriptionDueAmount || 0);
        const netAvailable = Math.max(0, Number(finance?.currentCycle?.netAvailable || 0));

        if (amount > netAvailable) {
            if (isRestaurantSubscriptionEnabled && subscriptionDue > 0) {
                return sendError(res, 400, `Withdrawal restricted. You can withdraw a maximum of ₹${netAvailable.toLocaleString('en-IN')} after reserving ₹${subscriptionDue.toLocaleString('en-IN')} for your outstanding subscription dues.`);
            }
            return sendError(res, 400, `Insufficient balance. Available to withdraw: ₹${netAvailable.toLocaleString('en-IN')}`);
        }

        // Create the withdrawal request
        const withdrawal = new FoodRestaurantWithdrawal({
            restaurantId,
            amount: Number(amount),
            bankDetails,
            status: 'pending'
        });

        await withdrawal.save();

        return sendResponse(res, 201, 'Withdrawal request submitted successfully', withdrawal);
    } catch (error) {
        next(error);
    }
};

export const listMyWithdrawalsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const withdrawals = await FoodRestaurantWithdrawal.find({ restaurantId })
            .sort({ createdAt: -1 })
            .lean();

        return sendResponse(res, 200, 'Withdrawals fetched successfully', withdrawals);
    } catch (error) {
        next(error);
    }
};
