import mongoose from 'mongoose';

const referralLogSchema = new mongoose.Schema(
    {
        // No field-level index: { referrerId, role, createdAt } below starts
        // with this field, so the planner already covers referrerId lookups.
        referrerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        refereeId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        role: {
            type: String,
            enum: ['USER', 'DELIVERY_PARTNER'],
            required: true,
            index: true
        },
        /** Reward for the referrer, snapshotted when the referral was made. */
        rewardAmount: { type: Number, required: true, min: 0, default: 0 },

        /**
         * Reward for the referred user, also snapshotted at referral time.
         * Both amounts are frozen here rather than read at settlement, so an
         * admin changing the reward later cannot retroactively alter what a
         * referral already promised.
         */
        referredRewardAmount: { type: Number, min: 0, default: 0 },

        status: {
            type: String,
            enum: ['pending', 'credited', 'rejected'],
            default: 'pending',
            index: true
        },

        /** Set when the referral is actually paid out. */
        settledAt: { type: Date, default: null },

        /** The order whose completion qualified this referral. */
        qualifyingOrderId: { type: mongoose.Schema.Types.ObjectId, default: null },

        reason: { type: String, default: '' }
    },
    { collection: 'food_referral_logs', timestamps: true }
);

// One referral credit decision per created account per role.
referralLogSchema.index({ refereeId: 1, role: 1 }, { unique: true });
referralLogSchema.index({ referrerId: 1, role: 1, createdAt: -1 });

export const FoodReferralLog = mongoose.model('FoodReferralLog', referralLogSchema);

