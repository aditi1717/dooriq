import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import mongoose from 'mongoose';
import { createTtlCache } from '../../../../utils/cache.js';
import {
    filterRestaurantsByRoadRadius,
    getDefaultServingRadiusKm,
} from '../../shared/restaurantVisibility.service.js';

/**
 * Upper bound on restaurants gathered before pagination. Keeps a broad search
 * ("a") from pulling an unbounded working set into memory while still leaving
 * enough rows for distance sorting and deep pages.
 */
const MAX_CANDIDATE_RESTAURANTS = 200;
const MAX_MATCHED_FOODS = 500;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Search-as-you-type means a handful of prefixes ("pi", "piz", "bur") account
 * for most traffic, and every user in a zone types the same popular ones. The
 * unanchored regex scans behind each query are the expensive part, so identical
 * queries are answered from a short-lived cache and concurrent duplicates share
 * one execution via the cache's single-flight behaviour.
 *
 * Coordinates are deliberately excluded from the cache key - they only affect
 * the final distance sort, which is applied per request after the lookup.
 */
const searchCache = createTtlCache({ ttlMs: 60_000, maxEntries: 500, name: 'search' });

export const invalidateSearchCache = () => searchCache.clear();

// Page and coordinates are excluded: the cached value is the full ordered-by-
// relevance match set, so every page and every location reuses one entry.
const cacheKey = ({ q, categoryId, minRating, maxDeliveryTime, isVeg, lat, lng }) => {
    const roundedLat = lat ? Number(lat).toFixed(2) : null;
    const roundedLng = lng ? Number(lng).toFixed(2) : null;
    return JSON.stringify({
        q: String(q || '').trim().toLowerCase(),
        categoryId: categoryId || null,
        minRating: minRating || null,
        maxDeliveryTime: maxDeliveryTime || null,
        isVeg: isVeg === 'true',
        lat: roundedLat,
        lng: roundedLng
    });
};

/**
 * Unified Search Service
 * Searches for restaurants by name/cuisine and by dish name, returning matched
 * restaurants with dish highlights for food matches.
 */
export const searchUnified = async (query = {}, options = {}) => {
    const { lat, lng, page = 1, limit = 20 } = query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Cache the broad match set, then apply per-request road-radius filtering
    // and pagination with the caller's current coordinates.
    const matched = await searchCache.get(cacheKey(query), () => searchUnifiedUncached(query));

    const all = matched?.restaurants || [];
    const userLat = Number(lat);
    const userLng = Number(lng);
    const hasCoordinates = Number.isFinite(userLat) && Number.isFinite(userLng);
    const origin = hasCoordinates ? { lat: userLat, lng: userLng } : null;

    let filtered = all;
    if (origin) {
        const defaultRadius = await getDefaultServingRadiusKm();
        filtered = await filterRestaurantsByRoadRadius(all, origin, {
            radiusKm: defaultRadius,
            includeFailedRoadChecks: false,
        });
    }

    return {
        success: true,
        data: {
            restaurants: filtered.slice(skip, skip + limitNum),
            total: filtered.length,
            page: pageNum,
            limit: limitNum,
            zoneFiltered: false
        }
    };
};

const searchUnifiedUncached = async (query = {}, options = {}) => {
    const {
        q,
        categoryId,
        minRating,
        maxDeliveryTime,
        isVeg,
        lat,
        lng
    } = query;

    const term = String(q || '').trim();
    const regex = term ? new RegExp(escapeRegex(term), 'i') : null;
    const vegOnly = isVeg === 'true';

    // The uncached layer returns the FULL match set. Distance sorting and
    // pagination are applied by `searchUnified` afterwards, so the cached value
    // stays independent of the caller's position and page.
    const emptyResult = {
        restaurants: [],
        zoneFiltered: false
    };

    // 1. Structural filter (rating / delivery time). These are indexed
    //    fields, so this is the cheap way to narrow the candidate set first.
    //    The old code instead loaded every active restaurant id in the database
    //    via a `distinct` scan on every keystroke and passed them all as a giant
    //    `$in` array - slow, and it grew without bound as restaurants were added.
    const restaurantFilter = { status: 'approved' };

    const userLat = Number(lat);
    const userLng = Number(lng);
    const wantsGeo = Number.isFinite(userLat) && Number.isFinite(userLng);

    if (wantsGeo) {
        restaurantFilter.location = {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [userLng, userLat]
                },
                $maxDistance: 30000 // Limit search to 30km (30,000 meters)
            }
        };
    }

    if (vegOnly) {
        restaurantFilter.pureVegRestaurant = true;
    }

    if (minRating) {
        const parsed = parseFloat(minRating);
        if (Number.isFinite(parsed)) restaurantFilter.rating = { $gte: parsed };
    }

    if (maxDeliveryTime) {
        const parsed = parseInt(maxDeliveryTime, 10);
        if (Number.isFinite(parsed)) restaurantFilter.estimatedDeliveryTimeMinutes = { $lte: parsed };
    }

    // 2. Category filter: categories live on food items, not restaurants.
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        const catFoodFilters = {
            categoryId: new mongoose.Types.ObjectId(categoryId),
            approvalStatus: 'approved',
            isAvailable: true
        };
        if (vegOnly) catFoodFilters.foodType = 'Veg';

        const catRestaurantIds = await FoodItem.distinct('restaurantId', catFoodFilters);
        if (catRestaurantIds.length === 0) return emptyResult;
        restaurantFilter._id = { $in: catRestaurantIds };
    }

    const restaurantDetailsMap = new Map();

    // 3. Search matching
    if (regex) {
        // A. Restaurant name / cuisine matches.
        const matchedRestaurants = await FoodRestaurant.find({
            ...restaurantFilter,
            $or: [
                { restaurantName: { $regex: regex } },
                { cuisines: { $regex: regex } }
            ]
        }).limit(MAX_CANDIDATE_RESTAURANTS).lean();

        matchedRestaurants.forEach((r) => {
            restaurantDetailsMap.set(r._id.toString(), { ...r, matchType: 'restaurant' });
        });

        // B. Dish-name matches.
        //
        //    The dish query is scoped to the restaurants that already passed the
        //    zone/category filter. Previously it took the first N dishes matching
        //    the term *anywhere in the country* and only then intersected them
        //    with the current zone - so if the global top matches happened to sit
        //    outside the user's zone, the search returned nothing. That is the
        //    cause of the empty (140-byte) search responses in production.
        const zoneRestaurantIds = await FoodRestaurant.distinct('_id', restaurantFilter);

        if (zoneRestaurantIds.length > 0) {
            const foodFilters = {
                approvalStatus: 'approved',
                isAvailable: true,
                restaurantId: { $in: zoneRestaurantIds },
                name: { $regex: regex }
            };
            if (vegOnly) foodFilters.foodType = 'Veg';

            const matchedFoods = await FoodItem.find(foodFilters)
                .select('restaurantId name image')
                .limit(MAX_MATCHED_FOODS)
                .lean();

            // Keep the first dish hit per restaurant.
            const dishByRestaurant = new Map();
            for (const food of matchedFoods) {
                const key = food.restaurantId.toString();
                if (!dishByRestaurant.has(key)) dishByRestaurant.set(key, food);
            }

            const newRestaurantIds = [...dishByRestaurant.keys()]
                .filter((id) => !restaurantDetailsMap.has(id))
                .slice(0, MAX_CANDIDATE_RESTAURANTS);

            if (newRestaurantIds.length > 0) {
                const rsForFoods = await FoodRestaurant.find({
                    ...restaurantFilter,
                    _id: { $in: newRestaurantIds.map((id) => new mongoose.Types.ObjectId(id)) }
                }).lean();

                rsForFoods.forEach((r) => {
                    const key = r._id.toString();
                    const dish = dishByRestaurant.get(key);
                    restaurantDetailsMap.set(key, {
                        ...r,
                        matchType: 'food',
                        matchedDish: dish?.name,
                        matchedDishImage: dish?.image,
                        matchedDishId: dish?._id
                    });
                });
            }
        }
    } else {
        // No search text -> list restaurants matching the structural filters.
        const allMatching = await FoodRestaurant.find(restaurantFilter)
            .sort({ rating: -1, createdAt: -1 })
            .limit(MAX_CANDIDATE_RESTAURANTS)
            .lean();

        allMatching.forEach((r) => {
            restaurantDetailsMap.set(r._id.toString(), r);
        });
    }

    if (restaurantDetailsMap.size === 0) return emptyResult;

    // 4. Drop restaurants with nothing orderable right now. Scoped to the
    //    candidates we actually matched instead of scanning the whole menu
    //    collection up front.
    const candidateIds = [...restaurantDetailsMap.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const stockFilter = {
        restaurantId: { $in: candidateIds },
        approvalStatus: 'approved',
        isAvailable: true
    };
    if (vegOnly) stockFilter.foodType = 'Veg';

    const stockedIds = await FoodItem.distinct('restaurantId', stockFilter);
    const stockedSet = new Set(stockedIds.map((id) => id.toString()));

    let results = [...restaurantDetailsMap.entries()]
        .filter(([id]) => stockedSet.has(id))
        .map(([, value]) => value);

    // Distance sorting is intentionally NOT done here: this result set is cached
    // and shared across users in the zone, so it must stay position-independent.
    // `searchUnified` applies the per-request distance ordering on the way out.

    return {
        restaurants: results,
        zoneFiltered: false
    };
};

/**
 * Fetch Admin-only categories
 */
export const getAdminCategories = async (query = {}) => {
    const filter = { 
        isActive: true, 
        isApproved: true,
        $or: [
            { restaurantId: { $exists: false } },
            { restaurantId: null },
            { restaurantId: { $eq: undefined } }
        ]
    };

    const categories = await FoodCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    return categories;
};
