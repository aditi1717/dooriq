import { getPublicGourmetRestaurants } from '../services/gourmet.service.js';
import { getLandingSettings } from '../services/landingSettings.service.js';
import { FoodHeroBanner } from '../models/heroBanner.model.js';
import { FoodUnder250Banner } from '../models/under250Banner.model.js';
import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { getPublicHomePromotionBanners } from '../services/homePromotionBanner.service.js';
import TopBanner from '../models/topBanner.model.js';
import { sendResponse } from '../../../../utils/response.js';
import mongoose from 'mongoose';

/** Public hero banners for user home: active only, sorted, with linkedRestaurants populated for click-through */
export const getPublicHeroBannersController = async (req, res, next) => {
    try {
        const docs = await FoodHeroBanner.find({ isActive: true })
            .sort({ sortOrder: 1, createdAt: -1 })
            .populate({
                path: 'linkedRestaurantIds',
                select: '_id restaurantName slug area city rating cuisines profileImage pureVegRestaurant',
                model: 'FoodRestaurant'
            })
            .lean();
        const banners = (docs || []).map((b) => {
            const { linkedRestaurantIds, ...rest } = b;
            return {
                ...rest,
                order: b.sortOrder,
                linkedRestaurants: Array.isArray(linkedRestaurantIds) ? linkedRestaurantIds : [],
                imageUrl: b.imageUrl
            };
        });
        return sendResponse(res, 200, 'Hero banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicTopBannersController = async (req, res, next) => {
    try {
        const docs = await TopBanner.find({ isActive: true }).sort('order').lean();
        return sendResponse(res, 200, 'Top banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicUnder250BannersController = async (req, res, next) => {
    try {
        const docs = await FoodUnder250Banner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const banners = (docs || []).map((b) => ({
            ...b,
            order: b.sortOrder
        }));
        return sendResponse(res, 200, 'Under 250 banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicDiningBannersController = async (req, res, next) => {
    try {
        const docs = await FoodDiningBanner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const banners = (docs || []).map((b) => ({
            ...b,
            order: b.sortOrder
        }));
        return sendResponse(res, 200, 'Dining banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicExploreIconsController = async (req, res, next) => {
    try {
        const docs = await FoodExploreIcon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const items = docs.map(({ targetPath, sortOrder, ...rest }) => ({ ...rest, link: targetPath, order: sortOrder }));
        return sendResponse(res, 200, 'Explore icons fetched', { items });
    } catch (error) {
        next(error);
    }
};

export const getPublicHomePromotionBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const banners = await getPublicHomePromotionBanners(zoneId);
        return sendResponse(res, 200, 'Home promotion banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicGourmetController = async (req, res, next) => {
    try {
        const { zoneId, lat, lng } = req.query;
        const docs = await getPublicGourmetRestaurants(zoneId, lat, lng);
        const restaurants = (docs || [])
            .filter((d) => d.restaurant) // Only include if restaurant data is populated (matches zone)
            .map((d) => ({
                ...(d.restaurant || {}),
                _id: d.restaurant?._id || d.restaurantId,
                priority: d.priority
            }));
        return sendResponse(res, 200, 'Gourmet restaurants fetched', { restaurants });
    } catch (error) {
        next(error);
    }
};

export const getPublicLandingSettingsController = async (req, res, next) => {
    try {
        const { zoneId, lat, lng } = req.query;
        const settings = await getLandingSettings();
        const ids = settings?.recommendedRestaurantIds || [];
        let recommendedRestaurants = [];
        if (Array.isArray(ids) && ids.length > 0) {
            const query = { _id: { $in: ids }, status: 'approved' };
            const restaurants = await FoodRestaurant.find(query)
                .select('restaurantName area city profileImage coverImages menuImages slug rating cuisines pureVegRestaurant zoneId location')
                .lean();

            const userLat = lat !== undefined && lat !== null ? Number(lat) : null;
            const userLng = lng !== undefined && lng !== null ? Number(lng) : null;
            const wantsGeo = userLat !== null && !isNaN(userLat) && userLng !== null && !isNaN(userLng);

            if (wantsGeo) {
                // Fetch global default serving radius (default to 7 km)
                let defaultRadius = 7;
                try {
                    const { getCachedBusinessSettings } = await import('../../admin/controllers/businessSettings.controller.js');
                    const busSettings = await getCachedBusinessSettings();
                    if (busSettings && typeof busSettings.defaultServingRadiusKm === 'number') {
                        defaultRadius = busSettings.defaultServingRadiusKm;
                    }
                } catch (e) {
                    console.error('Failed to load default serving radius from settings in Landing Settings:', e);
                }

                const calculateDistanceInKmLocal = (lat1, lon1, lat2, lon2) => {
                    const dLat = ((lat2 - lat1) * Math.PI) / 180;
                    const dLon = ((lon2 - lon1) * Math.PI) / 180;
                    const a =
                        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return 6371 * c;
                };

                recommendedRestaurants = restaurants.filter((r) => {
                    const rLat = Number(r.location?.latitude);
                    const rLng = Number(r.location?.longitude);
                    if (isNaN(rLat) || isNaN(rLng)) return false;
                    const distance = calculateDistanceInKmLocal(userLat, userLng, rLat, rLng);
                    return distance <= defaultRadius;
                });
            } else if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
                recommendedRestaurants = restaurants.filter((r) => String(r.zoneId) === String(zoneId));
            } else {
                recommendedRestaurants = restaurants;
            }
        }
        const payload = {
            ...settings,
            recommendedRestaurantIds: undefined,
            recommendedRestaurants
        };
        return sendResponse(res, 200, 'Landing settings fetched', payload);
    } catch (error) {
        next(error);
    }
};
