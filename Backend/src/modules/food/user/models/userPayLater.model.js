import mongoose from 'mongoose';

/**
 * The per-user Pay Later ledger.
 *
 * Only the outstanding balance is stored. Eligibility and the credit limit are
 * derived from business settings plus the user's delivered-order count on every
 * read, so raising the limit for everyone is a settings change rather than a
 * migration across this collection.
 */
const payLaterSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
        amountDue: { type: Number, default: 0, min: 0 },
        /** Set by an admin to withdraw Pay Later from one user regardless of settings. */
        isBlocked: { type: Boolean, default: false },
        entries: {
            type: [new mongoose.Schema(
                {
                    type: { type: String, enum: ['charge', 'repayment'], required: true },
                    amount: { type: Number, required: true, min: 0 },
                    orderId: { type: String, default: '' },
                    orderDisplayId: { type: String, default: '' },
                    description: { type: String, default: '' }
                },
                { timestamps: true }
            )],
            default: []
        }
    },
    { collection: 'food_user_pay_later', timestamps: true }
);

export const FoodUserPayLater = mongoose.model('FoodUserPayLater', payLaterSchema);
