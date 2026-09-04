import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserCart } from '../models/userCart.model.js';

const toUserId = (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    return new mongoose.Types.ObjectId(id);
};

const toCartItem = (raw) => {
    const itemId = String(raw?.itemId || raw?.id || raw?._id || '').trim();
    if (!itemId) return null;
    const quantity = Math.round(Number(raw?.quantity));
    const price = Number(raw?.price);
    return {
        itemId,
        name: String(raw?.name || '').trim(),
        price: Number.isFinite(price) && price > 0 ? price : 0,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        restaurantId: String(raw?.restaurantId || '').trim()
    };
};

const shape = (cart) => ({
    items: (cart?.items || []).map((item) => ({
        itemId: item.itemId,
        name: item.name || '',
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        restaurantId: item.restaurantId || ''
    })),
    restaurantId: cart?.restaurantId || '',
    restaurantName: cart?.restaurantName || '',
    updatedAt: cart?.updatedAt || null
});

export const getUserCart = async (userId) => {
    const cart = await FoodUserCart.findOne({ userId: toUserId(userId) }).lean();
    return { cart: shape(cart) };
};

/**
 * Replaces the stored cart wholesale.
 *
 * The client is the source of truth here — it sends the full basket on every
 * change — so merging would resurrect items the user just removed.
 */
export const replaceUserCart = async (userId, payload = {}) => {
    const items = (Array.isArray(payload.items) ? payload.items : [])
        .map(toCartItem)
        .filter(Boolean);

    const cart = await FoodUserCart.findOneAndUpdate(
        { userId: toUserId(userId) },
        {
            $set: {
                items,
                restaurantId: String(payload.restaurantId || '').trim(),
                restaurantName: String(payload.restaurantName || '').trim()
            }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return { cart: shape(cart) };
};

export const clearUserCart = async (userId) => {
    await FoodUserCart.deleteOne({ userId: toUserId(userId) });
    return { cart: shape(null) };
};
