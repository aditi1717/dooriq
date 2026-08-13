import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema(
    {
        referralRewardUser: { type: Number, min: 0, default: 0 },
        referredRewardUser: { type: Number, min: 0, default: 0 },
        referralRewardDelivery: { type: Number, min: 0, default: 0 },
        referredRewardDelivery: { type: Number, min: 0, default: 0 },
        referralLimitUser: { type: Number, min: 0, default: 0 },
        referralLimitDelivery: { type: Number, min: 0, default: 0 },
        userAppStoreUrl: { type: String, default: '' },
        userPlayStoreUrl: { type: String, default: '' },
        deliveryAppStoreUrl: { type: String, default: '' },
        deliveryPlayStoreUrl: { type: String, default: '' },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_referral_settings', timestamps: true }
);

referralSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodReferralSettings = mongoose.model('FoodReferralSettings', referralSettingsSchema);

