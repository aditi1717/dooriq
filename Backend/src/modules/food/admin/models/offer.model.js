import mongoose from 'mongoose';

const foodOfferSchema = new mongoose.Schema(
    {
        couponCode: { type: String, required: true, trim: true, uppercase: true, unique: true },
        discountType: { type: String, enum: ['percentage', 'flat-price'], default: 'percentage', index: true },
        discountValue: { type: Number, required: true, min: 0 },
        /**
         * Who may use this coupon.
         *  all        - any customer
         *  first-time - customers with no prior order
         *  selected   - only the customers listed in `userIds`
         */
        customerScope: { type: String, enum: ['all', 'first-time', 'selected'], default: 'all', index: true },
        /**
         * Targeted customers. Only meaningful when customerScope === 'selected'.
         * Enforced server-side in the coupon eligibility check, and used to hide
         * the coupon from everyone else's cart listing.
         */
        userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser' }],
        restaurantScope: { type: String, enum: ['all', 'selected'], default: 'all', index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' },
        restaurantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' }],
        minOrderValue: { type: Number, default: 0, min: 0 },
        maxDiscount: { type: Number, default: null, min: 0 },
        usageLimit: { type: Number, default: null, min: 0 },
        perUserLimit: { type: Number, default: null, min: 0 },
        usedCount: { type: Number, default: 0, min: 0 },
        startDate: { type: Date },
        isFirstOrderOnly: { type: Boolean, default: false },
        endDate: { type: Date },
        status: { type: String, enum: ['active', 'paused', 'inactive'], default: 'active', index: true },
        showInCart: { type: Boolean, default: true },
        createdByRole: { type: String, enum: ['ADMIN', 'RESTAURANT'], default: 'ADMIN', index: true },
        adminBearPercentage: { type: Number, default: 100, min: 0, max: 100 },
        restaurantBearPercentage: { type: Number, default: 0, min: 0, max: 100 }
    },
    { collection: 'food_offers', timestamps: true }
);

foodOfferSchema.index({ restaurantId: 1, createdAt: -1 });
foodOfferSchema.index({ restaurantIds: 1, createdAt: -1 });
// Cart listing filters targeted coupons by userId on every cart open.
foodOfferSchema.index({ customerScope: 1, userIds: 1 });

export const FoodOffer = mongoose.model('FoodOffer', foodOfferSchema);
