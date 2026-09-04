import { sendResponse } from '../../../../utils/response.js';
import { getUserCart, replaceUserCart, clearUserCart } from '../services/userCart.service.js';

export const getUserCartController = async (req, res, next) => {
    try {
        const data = await getUserCart(req.user?.userId);
        return sendResponse(res, 200, 'Cart fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const replaceUserCartController = async (req, res, next) => {
    try {
        const data = await replaceUserCart(req.user?.userId, req.body || {});
        return sendResponse(res, 200, 'Cart saved successfully', data);
    } catch (error) {
        next(error);
    }
};

export const clearUserCartController = async (req, res, next) => {
    try {
        const data = await clearUserCart(req.user?.userId);
        return sendResponse(res, 200, 'Cart cleared successfully', data);
    } catch (error) {
        next(error);
    }
};
