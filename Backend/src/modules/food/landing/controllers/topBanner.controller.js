import TopBanner from '../models/topBanner.model.js';
import { uploadImageBuffer, deleteImageFile } from '../../../../services/cloudinary.service.js';

export const listTopBannersController = async (req, res) => {
    try {
        const banners = await TopBanner.find().sort('order');
        res.status(200).json({ success: true, data: { banners } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch top banners', error: error.message });
    }
};

export const uploadTopBannersController = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No images provided' });
        }

        const uploadedBanners = [];
        const errors = [];

        for (const file of req.files) {
            try {
                const imagePath = await uploadImageBuffer(file.buffer);

                // Find max order
                const maxOrderBanner = await TopBanner.findOne().sort('-order');
                const nextOrder = maxOrderBanner ? maxOrderBanner.order + 1 : 0;

                const newBanner = new TopBanner({
                    image: imagePath,
                    publicId: imagePath,
                    order: nextOrder,
                    isActive: true
                });

                await newBanner.save();
                uploadedBanners.push(newBanner);
            } catch (err) {
                errors.push(`Failed to upload ${file.originalname}: ${err.message}`);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Top banners processed',
            data: { banners: uploadedBanners, errors }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteTopBannerController = async (req, res) => {
    try {
        const banner = await TopBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }

        if (banner.image || banner.publicId) {
            await deleteImageFile(banner.image || banner.publicId);
        }

        await TopBanner.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Banner deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete banner', error: error.message });
    }
};

export const updateTopBannerOrderController = async (req, res) => {
    try {
        const { order } = req.body;
        const banner = await TopBanner.findByIdAndUpdate(
            req.params.id,
            { order },
            { new: true }
        );
        if (!banner) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }
        res.status(200).json({ success: true, message: 'Order updated', data: { banner } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update order', error: error.message });
    }
};

export const toggleTopBannerStatusController = async (req, res) => {
    try {
        const banner = await TopBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({ success: false, message: 'Banner not found' });
        }
        banner.isActive = !banner.isActive;
        await banner.save();
        res.status(200).json({ success: true, message: 'Status updated', data: { banner } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update status', error: error.message });
    }
};
