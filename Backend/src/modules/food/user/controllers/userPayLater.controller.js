import { sendResponse } from '../../../../utils/response.js';
import {
    getPayLaterAccount,
    repayFromWallet,
    startRazorpayRepayment,
    verifyRazorpayRepayment
} from '../services/userPayLater.service.js';

export const getPayLaterController = async (req, res, next) => {
    try {
        const data = await getPayLaterAccount(req.user?.userId);
        return sendResponse(res, 200, 'Pay Later account fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const repayPayLaterFromWalletController = async (req, res, next) => {
    try {
        const data = await repayFromWallet(req.user?.userId);
        return sendResponse(res, 200, 'Pay Later dues cleared from wallet', data);
    } catch (error) {
        next(error);
    }
};

export const startPayLaterRazorpayController = async (req, res, next) => {
    try {
        const data = await startRazorpayRepayment(req.user?.userId);
        return sendResponse(res, 200, 'Repayment order created successfully', data);
    } catch (error) {
        next(error);
    }
};

export const verifyPayLaterRazorpayController = async (req, res, next) => {
    try {
        const data = await verifyRazorpayRepayment(req.user?.userId, req.body || {});
        return sendResponse(res, 200, 'Repayment verified successfully', data);
    } catch (error) {
        next(error);
    }
};
