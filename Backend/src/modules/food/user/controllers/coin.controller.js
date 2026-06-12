import { sendResponse } from '../../../../utils/response.js';
import * as userWalletService from '../services/userWallet.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export async function getCoinsInfoController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const result = await userWalletService.getCoinsInfo(userId);
        return sendResponse(res, 200, 'Coins info retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function submitCoinRedemptionController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const { coinsToRedeem, screenshotUrl } = req.body;
        
        if (!coinsToRedeem) throw new ValidationError('coinsToRedeem is required');
        if (!screenshotUrl) throw new ValidationError('screenshotUrl is required');

        const result = await userWalletService.submitCoinRedemption(userId, coinsToRedeem, screenshotUrl);
        return sendResponse(res, 200, 'Redemption request submitted successfully', result);
    } catch (err) {
        next(err);
    }
}
