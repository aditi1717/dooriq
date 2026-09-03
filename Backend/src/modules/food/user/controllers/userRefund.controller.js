import { sendResponse } from '../../../../utils/response.js';
import { getRefundHistory } from '../services/userRefund.service.js';

export const getRefundHistoryController = async (req, res, next) => {
    try {
        const data = await getRefundHistory(req.user?.userId, req.query);
        return sendResponse(res, 200, 'Refunds fetched successfully', data);
    } catch (error) {
        next(error);
    }
};
