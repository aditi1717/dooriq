import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['addition', 'deduction', 'refund'],
            required: true
        },
        amount: { type: Number, required: true },
        status: { type: String, default: 'Completed' }, // UI expects "Completed"
        description: { type: String, default: '' },
        metadata: { type: Object, default: {} },
        razorpayOrderId: { type: String, default: null },
        razorpayPaymentId: { type: String, default: null },
        razorpaySignature: { type: String, default: null }
    },
    { timestamps: true }
);

const userWalletSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
        balance: { type: Number, default: 0 },
        referralEarnings: { type: Number, default: 0 },
        coinBalance: { type: Number, default: 0 },
        coinTransactions: [{
            amount: { type: Number, required: true }, // positive for earned, negative for redeemed/expired
            type: { type: String, enum: ['earned', 'redeemed', 'expired', 'refunded'], required: true },
            expiresAt: { type: Date, default: null }, // Only for earned coins
            description: { type: String, default: '' },
            createdAt: { type: Date, default: Date.now }
        }],
        transactions: { type: [walletTransactionSchema], default: [] }
    },
    { collection: 'food_user_wallets', timestamps: true }
);

export const FoodUserWallet = mongoose.model('FoodUserWallet', userWalletSchema);

