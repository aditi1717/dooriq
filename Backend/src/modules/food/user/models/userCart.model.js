import mongoose from 'mongoose';

/**
 * A dish as the user app sends it. Deliberately a snapshot, not a reference:
 * this collection exists so a cart survives a device switch, and checkout
 * re-prices everything against the live menu anyway.
 */
const cartItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, default: '', trim: true },
        price: { type: Number, default: 0, min: 0 },
        quantity: { type: Number, default: 1, min: 1 },
        restaurantId: { type: String, default: '', trim: true }
    },
    { _id: false }
);

const userCartSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
        items: { type: [cartItemSchema], default: [] },
        restaurantId: { type: String, default: '', trim: true },
        restaurantName: { type: String, default: '', trim: true }
    },
    { collection: 'food_user_carts', timestamps: true }
);

export const FoodUserCart = mongoose.model('FoodUserCart', userCartSchema);
