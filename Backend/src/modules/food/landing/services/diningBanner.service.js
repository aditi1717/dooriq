import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { uploadImageBuffer, deleteImageFile } from '../../../../services/cloudinary.service.js';

export const listDiningBanners = async () => {
    return FoodDiningBanner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
};

const getNextSortOrder = async () => {
    const last = await FoodDiningBanner.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (last?.sortOrder ?? -1) + 1;
};

export const createDiningBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];

    for (const file of files) {
        try {
            const imageUrl = await uploadImageBuffer(file.buffer);
            const sortOrder = meta.sortOrder ?? (await getNextSortOrder());

            const banner = await FoodDiningBanner.create({
                imageUrl,
                publicId: imageUrl,
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                diningType: meta.diningType,
                sortOrder,
                isActive: true,
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const deleteDiningBanner = async (id) => {
    const doc = await FoodDiningBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    if (doc.imageUrl || doc.publicId) {
        await deleteImageFile(doc.imageUrl || doc.publicId);
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const updateDiningBannerOrder = async (id, sortOrder) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleDiningBannerStatus = async (id, isActive) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
    ).lean();
    return updated;
};

