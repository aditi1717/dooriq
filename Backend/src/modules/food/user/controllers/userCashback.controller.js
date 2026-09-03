import { sendResponse } from '../../../../utils/response.js';
import { getCashbackHistory, getCashbackSettings, updateCashbackSettings } from '../services/userCashback.service.js';

export const getCashbackHistoryController = async (req, res, next) => {
    try {
        const data = await getCashbackHistory(req.user?.userId, req.query);
        return sendResponse(res, 200, 'Cashback history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getCashbackSettingsController = async (req, res, next) => {
    try {
        const data = await getCashbackSettings();
        return sendResponse(res, 200, 'Cashback settings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const updateCashbackSettingsController = async (req, res, next) => {
    try {
        const data = await updateCashbackSettings(req.body || {});
        return sendResponse(res, 200, 'Cashback settings updated successfully', data);
    } catch (error) {
        next(error);
    }
};
