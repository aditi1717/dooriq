import mongoose from 'mongoose';

/**
 * Admin-configured order cashback. Single document, same shape the user app
 * renders its banner from.
 */
const cashbackSettingsSchema = new mongoose.Schema(
    {
        isEnabled: { type: Boolean, default: false },
        cashbackType: { type: String, enum: ['percentage', 'flat'], default: 'percentage' },
        /** Percent when [cashbackType] is `percentage`, rupees when `flat`. */
        cashbackValue: { type: Number, default: 0, min: 0 },
        minOrderValue: { type: Number, default: 0, min: 0 },
        /** Ceiling per order. Ignored when 0. */
        maxCashback: { type: Number, default: 0, min: 0 }
    },
    { collection: 'food_cashback_settings', timestamps: true }
);

export const FoodCashbackSettings = mongoose.model('FoodCashbackSettings', cashbackSettingsSchema);
