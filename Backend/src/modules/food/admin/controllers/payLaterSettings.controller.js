import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const PAY_LATER_DEFAULT = {
    isEnabled: false,
    minDeliveredOrders: 5,
    creditLimit: 500
};

const buildPayLaterPayload = (payload = {}, existing = PAY_LATER_DEFAULT) => {
    const number = (value, fallback, label) => {
        if (value === undefined || value === null || value === '') return fallback;
        const parsed = Number(value);
        // Explicitly reject rather than falling back: silently ignoring a bad
        // creditLimit would leave the admin believing they had raised it.
        if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError(`${label} must be a positive number`);
        return parsed;
    };

    return {
        isEnabled: typeof payload.isEnabled === 'boolean' ? payload.isEnabled : existing.isEnabled,
        minDeliveredOrders: number(payload.minDeliveredOrders, existing.minDeliveredOrders, 'minDeliveredOrders'),
        creditLimit: number(payload.creditLimit, existing.creditLimit, 'creditLimit')
    };
};

export async function getPayLaterSettings(req, res, next) {
    try {
        const settings = await FoodBusinessSettings.findOne().select('payLaterSettings').lean();
        const payload = buildPayLaterPayload(settings?.payLaterSettings || {}, {
            ...PAY_LATER_DEFAULT,
            ...(settings?.payLaterSettings || {})
        });
        return sendResponse(res, 200, 'Pay Later settings fetched successfully', payload);
    } catch (error) {
        next(error);
    }
}

export async function updatePayLaterSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings({ companyName: 'Dooriq', email: 'admin@dooriq.com' });
        }

        settings.payLaterSettings = buildPayLaterPayload(req.body || {}, {
            ...PAY_LATER_DEFAULT,
            ...(settings.payLaterSettings?.toObject?.() || settings.payLaterSettings || {})
        });
        await settings.save();

        return sendResponse(res, 200, 'Pay Later settings updated successfully', settings.payLaterSettings);
    } catch (error) {
        next(error);
    }
}
