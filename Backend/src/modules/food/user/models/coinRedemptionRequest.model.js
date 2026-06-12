import mongoose from 'mongoose';

const coinRedemptionRequestSchema = new mongoose.Schema(
    {
        userId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'FoodUser',
            required: true, 
            index: true 
        },
        coinsRedeemed: { 
            type: Number, 
            required: true,
            min: 1
        },
        amountToCredit: { 
            type: Number, 
            required: true,
            min: 0
        },
        screenshotUrl: { 
            type: String, 
            required: true 
        },
        status: { 
            type: String, 
            enum: ['pending', 'approved', 'rejected'], 
            default: 'pending',
            index: true
        },
        adminNote: { 
            type: String, 
            default: '' 
        },
        processedAt: { 
            type: Date, 
            default: null 
        }
    },
    { 
        collection: 'food_coin_redemption_requests', 
        timestamps: true 
    }
);

export const CoinRedemptionRequest = mongoose.model('CoinRedemptionRequest', coinRedemptionRequestSchema);
