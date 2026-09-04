import mongoose from 'mongoose';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';

const LIMIT_DEFAULT = 200;

// The ₹99 store asks for every eligible dish in one call and pages through the
// result on the device, so this ceiling is what "all of them" actually means.
// ponytail: single-page feed, add ?page= server-side paging if a zone ever
// carries more than this many sub-₹99 dishes.
const LIMIT_MAX = 1000;

/**
 * Price ceilings for the promotional rails on the home screen. The user app
 * re-applies the same cap client-side, so these only have to stop the feed
 * from shipping the whole catalogue for a ₹99 rail.
 */
const PROMO_PRICE_CAP = {
    switch99: 99,
    'under-250': 250
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

/**
 * Restaurants a dish may be surfaced from: approved, and — when the caller sent
 * a zone — either in that zone or not zoned at all.
 *
 * Unzoned restaurants stay visible on purpose: `zoneId` is optional on the
 * restaurant document, and excluding them would empty the feed for every
 * deployment that has not finished drawing its zones.
 */
const visibleRestaurantIds = async (zoneId) => {
    const filter = { status: 'approved' };
    if (isObjectId(zoneId)) {
        filter.$or = [
            { zoneId: toObjectId(zoneId) },
            { zoneId: { $exists: false } },
            { zoneId: null }
        ];
    }
    return FoodRestaurant.distinct('_id', filter);
};

/**
 * `GET /food/restaurant/public/foods` — the cross-restaurant dish feed behind
 * the home rails, dish search and the ₹99 store.
 *
 * Returns dish documents unchanged apart from the restaurant name, because the
 * stored shape already matches what the app parses.
 */
export const listPublicFoods = async (query = {}) => {
    const requested = parseInt(query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : LIMIT_DEFAULT, 1), LIMIT_MAX);

    const restaurantIds = await visibleRestaurantIds(query.zoneId);
    if (!restaurantIds.length) return { foods: [] };

    const filter = {
        approvalStatus: 'approved',
        isAvailable: true,
        restaurantId: { $in: restaurantIds }
    };

    const cap = PROMO_PRICE_CAP[String(query.promo || '').trim()];
    if (cap) filter.price = { $lte: cap };

    // Categories are addressed by slug from the app but stored by name, so the
    // slug is resolved to ids first rather than matched against dish text.
    const slug = String(query.categorySlug || '').trim();
    if (slug) {
        const categoryIds = await FoodCategory.distinct('_id', {
            name: { $regex: `^${slug.replace(/-/g, '[ -]')}$`, $options: 'i' }
        });
        if (!categoryIds.length) return { foods: [] };
        filter.categoryId = { $in: categoryIds };
    }

    const foods = await FoodItem.find(filter)
        .sort({ isRecommended: -1, createdAt: -1 })
        .limit(limit)
        .lean();

    const names = new Map(
        (await FoodRestaurant.find({ _id: { $in: foods.map((f) => f.restaurantId) } })
            .select('restaurantName')
            .lean()).map((r) => [String(r._id), r.restaurantName || ''])
    );

    return {
        foods: foods.map((food) => ({
            ...food,
            restaurantName: names.get(String(food.restaurantId)) || ''
        }))
    };
};
