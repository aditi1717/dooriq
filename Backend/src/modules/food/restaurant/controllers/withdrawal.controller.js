import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import { FoodBusinessSettings } from '../../admin/models/businessSettings.model.js';

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { amount, bankDetails } = req.body;

        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');
        if (!amount || amount <= 0) return sendError(res, 400, 'Invalid withdrawal amount');

        const finance = await getRestaurantFinance(restaurantId);
        const netAvailable = Math.max(0, Number(finance?.currentCycle?.netAvailable || 0));

        if (amount > netAvailable) {
            return sendError(res, 400, `Insufficient balance. Available to withdraw: INR ${netAvailable.toLocaleString('en-IN')}`);
        }

        const settings = await FoodBusinessSettings.findOne().lean();
        const tdsPercentage = Number(settings?.restaurantTdsPercentage || 0);
        const tdsAmount = Number((Number(amount) * (tdsPercentage / 100)).toFixed(2));
        const netAmount = Number((Number(amount) - tdsAmount).toFixed(2));

        const withdrawal = new FoodRestaurantWithdrawal({
            restaurantId,
            amount: Number(amount),
            tdsPercentage,
            tdsAmount,
            netAmount,
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
