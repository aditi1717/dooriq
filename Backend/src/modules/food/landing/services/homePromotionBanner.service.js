import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import { uploadImageBuffer, deleteImageFile } from '../../../../services/cloudinary.service.js';

export const listHomePromotionBanners = async () => {
    return HomePromotionBanner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const getPublicHomePromotionBanners = async (zoneId = null) => {
    const now = new Date();
    const filter = {
        isActive: true,
        $and: [
            {
                $or: [
                    { startDate: { $lte: now } },
                    { startDate: null },
                    { startDate: "" },
                    { startDate: { $exists: false } }
                ]
            },
            {
                $or: [
                    { endDate: { $gte: now } },
                    { endDate: null },
                    { endDate: "" },
                    { endDate: { $exists: false } }
                ]
            }
        ]
    };

    if (zoneId) {
        filter.zoneId = zoneId;
    }

    return HomePromotionBanner.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
};

export const createHomePromotionBanner = async (file, meta = {}) => {
    if (!file) return null;

    try {
        const imageUrl = await uploadImageBuffer(file.buffer);

        return await HomePromotionBanner.create({
            imageUrl,
            publicId: imageUrl,
            title: meta.title,
            ctaLink: meta.ctaLink,
            zoneId: meta.zoneId || null,
            startDate: (meta.startDate && meta.startDate !== "") ? new Date(meta.startDate) : null,
            endDate: (meta.endDate && meta.endDate !== "") ? new Date(meta.endDate) : null,
            sortOrder: meta.sortOrder ?? 0,
            isActive: true
        });
    } catch (error) {
        throw new Error(`Banner creation failed: ${error.message}`);
    }
};

export const updateHomePromotionBanner = async (id, data) => {
    const updateData = { ...data };
    if (data.startDate !== undefined) updateData.startDate = (data.startDate && data.startDate !== "") ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = (data.endDate && data.endDate !== "") ? new Date(data.endDate) : null;

    return HomePromotionBanner.findByIdAndUpdate(id, updateData, { new: true }).lean();
};

export const deleteHomePromotionBanner = async (id) => {
    const doc = await HomePromotionBanner.findById(id);
    if (!doc) return { deleted: false };

    if (doc.imageUrl || doc.publicId) {
        await deleteImageFile(doc.imageUrl || doc.publicId);
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const toggleHomePromotionBannerStatus = async (id, isActive) => {
    return HomePromotionBanner.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
};

export const updateHomePromotionBannerOrder = async (id, sortOrder) => {
    return HomePromotionBanner.findByIdAndUpdate(id, { sortOrder }, { new: true }).lean();
};
