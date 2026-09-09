import { FoodRestaurant } from '../models/restaurant.model.js';
import { uploadImageBuffer, uploadImageBuffers } from '../../../../services/cloudinary.service.js';
import { deleteImageFile } from '../../../../services/imageStorage.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';

/** Gallery cap surfaced to the app as `maxGalleryImages`. */
const MAX_GALLERY_IMAGES = 10;

/** Cover slots kept in `coverImages` (shared with POST /profile/cover-images). */
const MAX_COVER_IMAGES = 20;

const toUrl = (v) => (typeof v === 'string' ? v : v?.url || '');

const normalizeUrls = (list) =>
    (Array.isArray(list) ? list : []).map(toUrl).filter(Boolean);

/** URLs are compared by filename so a stored relative path still matches an
 *  absolute one the client may have resolved against the server origin. */
export const sameImage = (a, b) => {
    if (a === b) return true;
    const basename = (v) => String(v || '').split('?')[0].split('/').pop();
    const left = basename(a);
    return Boolean(left) && left === basename(b);
};

const toMediaPayload = (restaurant) => ({
    coverImage: normalizeUrls(restaurant?.coverImages)[0] || '',
    galleryImages: normalizeUrls(restaurant?.galleryImages),
    maxGalleryImages: MAX_GALLERY_IMAGES
});

const loadRestaurant = async (restaurantId) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('coverImages galleryImages')
        .lean();
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    return restaurant;
};

export const getRestaurantMedia = async (restaurantId) =>
    toMediaPayload(await loadRestaurant(restaurantId));

/**
 * Replaces the primary cover image (`coverImages[0]`), leaving the remaining
 * cover slots — and the restaurant's approval status — untouched.
 */
export const uploadRestaurantCoverImage = async (restaurantId, file) => {
    const restaurant = await loadRestaurant(restaurantId);
    if (!file?.buffer) throw new ValidationError('An image file is required');

    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/cover');
    const existing = normalizeUrls(restaurant.coverImages);
    const previousCover = existing[0] || '';
    const coverImages = [url, ...existing.slice(1)].slice(0, MAX_COVER_IMAGES);

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { coverImages } });
    if (previousCover) await deleteImageFile(previousCover);

    return toMediaPayload({ ...restaurant, coverImages });
};

export const addRestaurantGalleryImages = async (restaurantId, files = []) => {
    const restaurant = await loadRestaurant(restaurantId);

    const validFiles = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const existing = normalizeUrls(restaurant.galleryImages);
    const remaining = MAX_GALLERY_IMAGES - existing.length;
    if (remaining <= 0) {
        throw new ValidationError(`Gallery is full (max ${MAX_GALLERY_IMAGES} images)`);
    }
    if (validFiles.length > remaining) {
        throw new ValidationError(
            `Only ${remaining} more image${remaining === 1 ? '' : 's'} can be added (max ${MAX_GALLERY_IMAGES})`
        );
    }

    const uploaded = await uploadImageBuffers(
        validFiles.map((file) => file.buffer),
        'food/restaurants/gallery',
    );
    const galleryImages = [...existing, ...uploaded.filter(Boolean)];

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { galleryImages } });

    return toMediaPayload({ ...restaurant, galleryImages });
};

export const removeRestaurantGalleryImage = async (restaurantId, imageUrl) => {
    const restaurant = await loadRestaurant(restaurantId);

    const target = String(imageUrl || '').trim();
    if (!target) throw new ValidationError('imageUrl is required');

    const existing = normalizeUrls(restaurant.galleryImages);
    const galleryImages = existing.filter((url) => !sameImage(url, target));
    if (galleryImages.length === existing.length) {
        throw new NotFoundError('Image not found in gallery');
    }

    await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: { galleryImages } });
    await deleteImageFile(target);

    return toMediaPayload({ ...restaurant, galleryImages });
};
