import { sendResponse } from '../../../../utils/response.js';
import {
    getFavorites,
    addFavoriteRestaurant,
    removeFavoriteRestaurant,
    addFavoriteFood,
    removeFavoriteFood
} from '../services/userFavorite.service.js';

export const getFavoritesController = async (req, res, next) => {
    try {
        const data = await getFavorites(req.user?.userId);
        return sendResponse(res, 200, 'Favorites fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const addFavoriteRestaurantController = async (req, res, next) => {
    try {
        const data = await addFavoriteRestaurant(req.user?.userId, req.params.restaurantId);
        return sendResponse(res, 200, 'Restaurant added to favorites', data);
    } catch (error) {
        next(error);
    }
};

export const removeFavoriteRestaurantController = async (req, res, next) => {
    try {
        const data = await removeFavoriteRestaurant(req.user?.userId, req.params.restaurantId);
        return sendResponse(res, 200, 'Restaurant removed from favorites', data);
    } catch (error) {
        next(error);
    }
};

export const addFavoriteFoodController = async (req, res, next) => {
    try {
        const data = await addFavoriteFood(req.user?.userId, req.params.foodId);
        return sendResponse(res, 200, 'Food added to favorites', data);
    } catch (error) {
        next(error);
    }
};

export const removeFavoriteFoodController = async (req, res, next) => {
    try {
        const data = await removeFavoriteFood(req.user?.userId, req.params.foodId);
        return sendResponse(res, 200, 'Food removed from favorites', data);
    } catch (error) {
        next(error);
    }
};
