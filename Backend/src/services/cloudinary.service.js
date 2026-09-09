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

/**
 * Largest number of images to resize at the same time.
 *
 * Sharp does its work on the libuv threadpool rather than the main thread, so
 * this does not block the event loop — but decode/resize/encode is CPU-bound,
 * and the callers here were firing up to 20 at once on a 2-core box. Two
 * restaurants uploading a menu simultaneously was enough to starve request
 * handling of CPU.
 *
 * Keep this at or below the core count. Raising it does not make a batch
 * finish sooner once the cores are saturated; it only makes everything else
 * on the box slower while it runs.
 */
const UPLOAD_CONCURRENCY = Math.max(1, Number(process.env.IMAGE_UPLOAD_CONCURRENCY || 2));

/**
 * Upload many image buffers with bounded concurrency, preserving input order.
 *
 * Workers pull from a shared cursor rather than the array being pre-split, so
 * one slow large image does not leave a worker idle while others queue behind
 * it. Rejects on the first failure, matching the Promise.all behaviour this
 * replaced.
 *
 * @param {Array<Buffer>} buffers
 * @param {string} [folder]
 * @returns {Promise<string[]>} stored URLs, in the same order as `buffers`
 */
export const uploadImageBuffers = async (buffers = [], folder = 'uploads') => {
    const list = Array.isArray(buffers) ? buffers : [];
    if (!list.length) return [];

    const results = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= list.length) return;
            results[index] = await uploadImageBuffer(list[index], folder);
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, list.length) }, worker),
    );

    return results;
};

export { deleteImageFile };
