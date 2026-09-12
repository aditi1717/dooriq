import mongoose from 'mongoose';

const businessSettingsSchema = new mongoose.Schema(
    {
        companyName: { type: String, required: true, default: 'Dooriq' },
        email: { type: String, required: true, default: 'admin@dooriq.com' },
        phone: {
            countryCode: { type: String, default: '+91' },
            number: { type: String, default: '' }
        },
        address: { type: String, default: '' },
        state: { type: String, default: '' },
        pincode: { type: String, default: '' },
        region: { type: String, default: 'India' },
        logo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        favicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        restaurantLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        restaurantFavicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        deliveryLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        deliveryFavicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        powerScanning: {
            user: {
                themeColor: { type: String, default: '#2B04C1' },
                fontFamily: { type: String, default: 'Poppins' }
            },
            restaurant: {
                themeColor: { type: String, default: '#2563EB' },
                fontFamily: { type: String, default: 'Poppins' }
            },
            delivery: {
                themeColor: { type: String, default: '#00B761' },
                fontFamily: { type: String, default: 'Poppins' }
            }
        },
        orderAcceptanceTimeMinutes: { type: Number, default: 4, min: 1, max: 20 },
        coinSettings: {
            isActive: { type: Boolean, default: true },
            minCoinsPerOrder: { type: Number, default: 1 },
            maxCoinsPerOrder: { type: Number, default: 3 },
            coinExpiryDays: { type: Number, default: 30 },
            coinToWalletValue: { type: Number, default: 10, min: 0 },
            reviewUrl: { type: String, default: '' },
        },
        payLaterSettings: {
            isEnabled: { type: Boolean, default: false },
            /** Delivered orders a user needs before Pay Later unlocks. */
            minDeliveredOrders: { type: Number, default: 5, min: 0 },
            /** Credit granted once eligible, in rupees. */
            creditLimit: { type: Number, default: 500, min: 0 }
        },
        restaurantTdsPercentage: { type: Number, default: 0, min: 0, max: 100 },
        deliveryBoyTdsPercentage: { type: Number, default: 0, min: 0, max: 100 },
        defaultServingRadiusKm: { type: Number, default: 7 },

        /**
         * Ceiling on how much of a single order wallet balance may cover, as a
         * percentage of the order total.
         *
         * Wallet balance is largely referral and cashback credit, so allowing it
         * to settle an entire order turns promotional credit into free food.
         * 100 preserves the previous behaviour, so adding this changes nothing
         * until an admin lowers it.
         */
        walletUsagePercentPerOrder: { type: Number, default: 100, min: 0, max: 100 },
        paymentMethods: {
            cashOnDelivery: { type: Boolean, default: true },
            wallet: { type: Boolean, default: true },
            online: { type: Boolean, default: true }
        },
        launchCountdown: {
            isEnabled: { type: Boolean, default: false },
            timerTime: { type: String, default: '' },
            timerText: { type: String, default: '' },
            timerDescription: { type: String, default: '' },
            showLaunchPageOnly: { type: Boolean, default: false }
        },

        /**
         * Maintenance mode.
         *
         * `isEnabled` is the master switch. The window is optional and is what
         * makes this schedulable rather than a bare toggle:
         *
         *   isEnabled, no window          -> down now, until switched off
         *   isEnabled + startsAt          -> down from then on
         *   isEnabled + startsAt + endsAt -> down only inside that window,
         *                                    and comes back up on its own
         *   isEnabled + endsAt only       -> down now, back up at endsAt
         *
         * Storing the window rather than flipping a boolean on a timer means
         * nothing has to still be running at the end of the window for the
         * site to come back, and every worker reaches the same verdict from
         * the same document.
         */
        maintenance: {
            isEnabled: { type: Boolean, default: false },
            /** Shown on the maintenance screen. Falls back to generic copy. */
            message: {
                type: String,
                default: '',
                trim: true,
                maxlength: 500
            },
            /** Null means "from now". */
            startsAt: { type: Date, default: null },
            /** Null means "until an admin turns it off". */
            endsAt: { type: Date, default: null },
            /** Audit trail, so it is clear who took the site down. */
            updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
            updatedAt: { type: Date, default: null }
        }
    },
    { timestamps: true }
);

export const FoodBusinessSettings = mongoose.model('FoodBusinessSettings', businessSettingsSchema);
