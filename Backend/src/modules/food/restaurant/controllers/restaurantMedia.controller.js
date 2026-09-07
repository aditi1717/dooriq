import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    getRestaurantMedia,
    uploadRestaurantCoverImage,
    addRestaurantGalleryImages,
    removeRestaurantGalleryImage
} from '../services/restaurantMedia.service.js';

const requireRestaurantId = (req, res) => {
    const restaurantId = req.user?.userId;
    if (!restaurantId) {
        sendError(res, 401, 'Restaurant authentication required');
        return null;
    }
    return restaurantId;
};

export const getRestaurantMediaController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req, res);
        if (!restaurantId) return;
        const media = await getRestaurantMedia(restaurantId);
        return sendResponse(res, 200, 'Media fetched successfully', media);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImageController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req, res);
        if (!restaurantId) return;
        const media = await uploadRestaurantCoverImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Cover image updated successfully', media);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantGalleryImagesController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req, res);
        if (!restaurantId) return;
        const media = await addRestaurantGalleryImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Gallery images uploaded successfully', media);
    } catch (error) {
        next(error);
    }
};

export const deleteRestaurantGalleryImageController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req, res);
        if (!restaurantId) return;
        // The app sends the URL in a JSON body on DELETE; accept a query param too.
        const imageUrl = req.body?.imageUrl ?? req.query?.imageUrl;
        const media = await removeRestaurantGalleryImage(restaurantId, imageUrl);
        return sendResponse(res, 200, 'Gallery image removed successfully', media);
    } catch (error) {
        next(error);
    }
};
