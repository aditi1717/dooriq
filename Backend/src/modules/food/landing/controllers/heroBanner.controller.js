import {
    listHeroBanners,
    createHeroBannersFromFiles,
    deleteHeroBanner,
    updateHeroBannerOrder,
    toggleHeroBannerStatus
} from '../services/heroBanner.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export const listHeroBannersController = async (req, res, next) => {
    try {
        const data = await listHeroBanners();
        const mappedData = (data || []).map((banner) => ({
            ...banner,
            order: banner.sortOrder
        }));
        // Wrap in { banners } to match LandingPageManagement.jsx expectations
        return sendResponse(res, 200, 'Hero banners fetched successfully', { banners: mappedData });
    } catch (error) {
        next(error);
    }
};

export const uploadHeroBannersController = async (req, res, next) => {
    try {
        if (!req.files || !req.files.length) {
            throw new ValidationError('No files uploaded');
        }

        const meta = {
            title: req.body.title,
            ctaText: req.body.ctaText,
            ctaLink: req.body.ctaLink
        };

        const results = await createHeroBannersFromFiles(req.files, meta);
        return sendResponse(res, 201, 'Hero banners uploaded', { results });
    } catch (error) {
        next(error);
    }
};

export const deleteHeroBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const result = await deleteHeroBanner(id);
        return sendResponse(res, 200, result.deleted ? 'Hero banner deleted' : 'Hero banner not found', result);
    } catch (error) {
        next(error);
    }
};

export const updateHeroBannerOrderController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { sortOrder, order } = req.body;
        const finalSortOrder = sortOrder !== undefined ? sortOrder : (order !== undefined ? Number(order) : undefined);
        if (!id || typeof finalSortOrder !== 'number' || Number.isNaN(finalSortOrder)) {
            throw new ValidationError('id and numeric sortOrder/order are required');
        }
        const updated = await updateHeroBannerOrder(id, finalSortOrder);
        const mapped = updated ? { ...updated, order: updated.sortOrder } : null;
        return sendResponse(res, 200, 'Hero banner order updated', mapped);
    } catch (error) {
        next(error);
    }
};

export const toggleHeroBannerStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        let { isActive } = req.body;
        if (isActive === undefined) {
            const banners = await listHeroBanners();
            const banner = banners.find(b => b._id.toString() === id);
            if (!banner) {
                throw new ValidationError('Hero banner not found');
            }
            isActive = !banner.isActive;
        } else if (typeof isActive !== 'boolean') {
            throw new ValidationError('boolean isActive is required');
        }
        const updated = await toggleHeroBannerStatus(id, isActive);
        const mapped = updated ? { ...updated, order: updated.sortOrder } : null;
        return sendResponse(res, 200, 'Hero banner status updated', mapped);
    } catch (error) {
        next(error);
    }
};

