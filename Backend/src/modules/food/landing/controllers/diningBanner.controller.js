import {
    listDiningBanners,
    createDiningBannersFromFiles,
    deleteDiningBanner,
    updateDiningBannerOrder,
    toggleDiningBannerStatus
} from '../services/diningBanner.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export const listDiningBannersController = async (req, res, next) => {
    try {
        const data = await listDiningBanners();
        const mappedData = (data || []).map((banner) => ({
            ...banner,
            order: banner.sortOrder
        }));
        return sendResponse(res, 200, 'Dining banners fetched successfully', { banners: mappedData });
    } catch (error) {
        next(error);
    }
};

export const uploadDiningBannersController = async (req, res, next) => {
    try {
        if (!req.files || !req.files.length) {
            throw new ValidationError('No files uploaded');
        }

        const meta = {
            title: req.body.title,
            ctaText: req.body.ctaText,
            ctaLink: req.body.ctaLink,
            diningType: req.body.diningType,
        };

        const results = await createDiningBannersFromFiles(req.files, meta);
        return sendResponse(res, 201, 'Dining banners uploaded', { banners: results });
    } catch (error) {
        next(error);
    }
};

export const deleteDiningBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const result = await deleteDiningBanner(id);
        return sendResponse(res, 200, result.deleted ? 'Dining banner deleted' : 'Dining banner not found', result);
    } catch (error) {
        next(error);
    }
};

export const updateDiningBannerOrderController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { order, sortOrder } = req.body;
        const finalSortOrder = sortOrder !== undefined ? sortOrder : (order !== undefined ? Number(order) : undefined);
        if (!id || typeof finalSortOrder !== 'number' || Number.isNaN(finalSortOrder)) {
            throw new ValidationError('id and numeric order/sortOrder are required');
        }
        const updated = await updateDiningBannerOrder(id, finalSortOrder);
        const mapped = updated ? { ...updated, order: updated.sortOrder } : null;
        return sendResponse(res, 200, 'Dining banner order updated', mapped);
    } catch (error) {
        next(error);
    }
};

export const toggleDiningBannerStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const banners = await listDiningBanners();
        const banner = banners.find(b => b._id.toString() === id);
        if (!banner) {
            throw new ValidationError('Dining banner not found');
        }
        const updated = await toggleDiningBannerStatus(id, !banner.isActive);
        const mapped = updated ? { ...updated, order: updated.sortOrder } : null;
        return sendResponse(res, 200, 'Dining banner status updated', mapped);
    } catch (error) {
        next(error);
    }
};

