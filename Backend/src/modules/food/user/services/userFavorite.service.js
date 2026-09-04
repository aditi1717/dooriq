import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { FoodUserFavorite } from '../models/userFavorite.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { toRestaurantListItem } from '../../restaurant/services/restaurant.service.js';

const toUserId = (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    return new mongoose.Types.ObjectId(id);
};

const toEntityId = (entityId, label) => {
    const id = String(entityId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError(`${label} id is invalid`);
    }
    return new mongoose.Types.ObjectId(id);
};

/**
 * `GET /food/user/favorites` — ids plus the hydrated entities.
 *
 * Both are returned because the app needs the ids to paint the heart on cards
 * it already has, and the full documents to render the favourites screen
 * without a second round trip per entity.
 */
export const getFavorites = async (userId) => {
    const rows = await FoodUserFavorite.find({ userId: toUserId(userId) })
        .sort({ createdAt: -1 })
        .lean();

    const restaurantIds = rows.filter((r) => r.entityType === 'restaurant').map((r) => r.entityId);
    const foodIds = rows.filter((r) => r.entityType === 'food').map((r) => r.entityId);

    const [restaurants, foods] = await Promise.all([
        restaurantIds.length
            ? FoodRestaurant.find({ _id: { $in: restaurantIds }, status: 'approved' }).lean()
            : [],
        foodIds.length
            ? FoodItem.find({ _id: { $in: foodIds }, approvalStatus: 'approved' }).lean()
            : []
    ]);

    // Ids are reported from the saved rows, not from the hydrated documents, so
    // a dish whose restaurant is temporarily unapproved still shows as
    // favourited instead of silently un-hearting itself in the UI.
    return {
        restaurantIds: restaurantIds.map(String),
        foodIds: foodIds.map(String),
        restaurants: restaurants.map(toRestaurantListItem),
        foods
    };
};

const addFavorite = async (userId, entityType, entityId) => {
    const uid = toUserId(userId);
    const eid = toEntityId(entityId, entityType === 'restaurant' ? 'Restaurant' : 'Food');

    const exists = entityType === 'restaurant'
        ? await FoodRestaurant.exists({ _id: eid })
        : await FoodItem.exists({ _id: eid });
    if (!exists) {
        throw new NotFoundError(entityType === 'restaurant' ? 'Restaurant not found' : 'Food not found');
    }

    // Upsert rather than create: re-favouriting something already saved is a
    // no-op, not a duplicate-key error the app would surface as a failure.
    await FoodUserFavorite.updateOne(
        { userId: uid, entityType, entityId: eid },
        { $setOnInsert: { userId: uid, entityType, entityId: eid } },
        { upsert: true }
    );
    return getFavorites(userId);
};

const removeFavorite = async (userId, entityType, entityId) => {
    await FoodUserFavorite.deleteOne({
        userId: toUserId(userId),
        entityType,
        entityId: toEntityId(entityId, entityType === 'restaurant' ? 'Restaurant' : 'Food')
    });
    return getFavorites(userId);
};

export const addFavoriteRestaurant = (userId, id) => addFavorite(userId, 'restaurant', id);
export const removeFavoriteRestaurant = (userId, id) => removeFavorite(userId, 'restaurant', id);
export const addFavoriteFood = (userId, id) => addFavorite(userId, 'food', id);
export const removeFavoriteFood = (userId, id) => removeFavorite(userId, 'food', id);
