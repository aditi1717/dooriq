import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import { sendResponse } from '../../../../utils/response.js';

const COIN_SETTINGS_DEFAULT = {
    isActive: true,
    minCoinsPerOrder: 1,
    maxCoinsPerOrder: 3,
    coinExpiryDays: 30,
    coinToWalletValue: 10,
    reviewUrl: ''
};

const buildCoinSettingsPayload = (payload = {}, existing = COIN_SETTINGS_DEFAULT) => ({
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : existing.isActive,
    minCoinsPerOrder: Number(payload.minCoinsPerOrder) || existing.minCoinsPerOrder,
    maxCoinsPerOrder: Number(payload.maxCoinsPerOrder) || existing.maxCoinsPerOrder,
    coinExpiryDays: Number(payload.coinExpiryDays) || existing.coinExpiryDays,
    coinToWalletValue: Number(payload.coinToWalletValue) || existing.coinToWalletValue,
    reviewUrl: payload.reviewUrl !== undefined ? payload.reviewUrl : existing.reviewUrl
});

export async function getCoinSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne().lean();
        if (!settings) {
            settings = await FoodBusinessSettings.create({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }
        const payload = buildCoinSettingsPayload(settings?.coinSettings || {}, settings?.coinSettings || COIN_SETTINGS_DEFAULT);
        return sendResponse(res, 200, 'Coin settings fetched successfully', payload);
    } catch (error) {
        next(error);
    }
}

export async function updateCoinSettings(req, res, next) {
    try {
        const payload = req.body || {};
        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }

        settings.coinSettings = buildCoinSettingsPayload(payload, settings.coinSettings || COIN_SETTINGS_DEFAULT);
        await settings.save();

        return sendResponse(res, 200, 'Coin settings updated successfully', settings.coinSettings);
    } catch (error) {
        next(error);
    }
}
