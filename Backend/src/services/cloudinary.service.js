import { processAndSaveImage, deleteImageFile } from './imageStorage.service.js';

/**
 * Uploads an image buffer locally / to VPS storage using Sharp optimization & WebP conversion.
 * Replaces legacy Cloudinary uploads for MERN SOP VPS compliance.
 * 
 * @param {Buffer} buffer - Image buffer
 * @param {string} [_folder] - Folder argument (ignored per SOP - single root storage directory)
 * @returns {Promise<string>} Stored relative image URL path (/uploads/img_...webp)
 */
export const uploadImageBuffer = async (buffer, _folder = 'uploads') => {
    return processAndSaveImage(buffer);
};

/**
 * Detailed upload image buffer helper. Returns object with url property for compatibility.
 * 
 * @param {Buffer} buffer 
 * @param {string} [_folder] 
 * @returns {Promise<Object>} Object containing secure_url and url properties
 */
export const uploadImageBufferDetailed = async (buffer, _folder = 'uploads') => {
    const url = await processAndSaveImage(buffer);
    return {
        url,
        secure_url: url,
        public_id: url
    };
};

export { deleteImageFile };
