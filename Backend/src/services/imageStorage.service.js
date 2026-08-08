import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]);

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
    'application/pdf'
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Resolves the root upload directory path.
 * Per SOP / User Directive: All images are saved directly in a single root folder without subfolders.
 * Development default: Backend/uploads/
 * Production VPS default: /var/www/uploads/
 */
export const getUploadStorageDir = () => {
    if (process.env.UPLOAD_STORAGE_ROOT && process.env.UPLOAD_STORAGE_ROOT.trim()) {
        const customPath = process.env.UPLOAD_STORAGE_ROOT.trim();
        return path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
    }
    if (config.nodeEnv === 'production') {
        return '/var/www/uploads';
    }
    return path.join(process.cwd(), 'uploads');
};

/**
 * Ensures the root upload directory exists on disk.
 */
export const ensureUploadStorageDirExists = async () => {
    const dir = getUploadStorageDir();
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch (err) {
        logger.error(`Failed to create upload storage directory (${dir}): ${err.message}`);
    }
    return dir;
};

/**
 * Saves and optimizes an image buffer using Sharp.
 * Converts to WebP format with max 1200x1200 resolution and quality 82%.
 * All files are saved directly in the root upload folder without subfolders.
 * 
 * @param {Buffer} buffer - Image buffer
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} Relative image path (e.g., '/uploads/img_1721924538_a82hd.webp')
 */
export const processAndSaveImage = async (buffer, options = {}) => {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('Valid image buffer is required');
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File size exceeds limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }

    const storageDir = await ensureUploadStorageDirExists();

    // Sharp optimization & WebP conversion
    const optimizedWebpBuffer = await sharp(buffer)
        .rotate() // Auto-orient based on EXIF data
        .resize({
            width: options.maxWidth || 1200,
            height: options.maxHeight || 1200,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({ quality: options.quality || 82 })
        .toBuffer();

    // Generate unique filename (NO subfolders)
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const filename = `img_${uniqueSuffix}.webp`;
    const filePath = path.join(storageDir, filename);

    // Write file directly to root storage directory
    await fs.promises.writeFile(filePath, optimizedWebpBuffer);

    // Return stored path format: /uploads/<filename>
    return `/uploads/${filename}`;
};

/**
 * Saves an uploaded file buffer as either an optimized image or a raw PDF.
 *
 * @param {Buffer} buffer
 * @param {Object} options
 * @param {string} [options.mimeType]
 * @param {string} [options.originalname]
 * @returns {Promise<string>} Relative upload path
 */
export const processAndSaveUploadedFile = async (buffer, options = {}) => {
    const mimeType = String(options.mimeType || '').toLowerCase();
    const originalName = String(options.originalname || '');
    const originalExt = path.extname(originalName).toLowerCase();

    if (ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType) || originalExt === '.pdf') {
        if (!buffer || !Buffer.isBuffer(buffer)) {
            throw new Error('Valid file buffer is required');
        }

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
            throw new Error(`File size exceeds limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
        }

        const storageDir = await ensureUploadStorageDirExists();
        const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const filename = `doc_${uniqueSuffix}.pdf`;
        const filePath = path.join(storageDir, filename);

        await fs.promises.writeFile(filePath, buffer);
        return `/uploads/${filename}`;
    }

    return processAndSaveImage(buffer, options);
};

/**
 * Process base64 encoded image string (e.g. FlutterWebView in-app camera base64)
 * 
 * @param {string} base64String 
 * @returns {Promise<string>} Relative image path
 */
export const processAndSaveBase64Image = async (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        throw new Error('Base64 string is required');
    }

    // Strip prefix if data URI (e.g. data:image/png;base64,...)
    const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    return processAndSaveImage(buffer);
};

/**
 * Deletes an image from the root upload directory if it exists locally.
 * 
 * @param {string} imagePath - Relative path or URL (e.g. '/uploads/img_123.webp')
 */
export const deleteImageFile = async (imagePath) => {
    if (!imagePath || typeof imagePath !== 'string') return;

    try {
        const filename = path.basename(imagePath);
        if (!filename || filename === 'uploads') return;

        const storageDir = getUploadStorageDir();
        const fullPath = path.join(storageDir, filename);

        if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
            logger.info(`Deleted image file: ${filename}`);
        }
    } catch (err) {
        logger.warn(`Failed to delete image file (${imagePath}): ${err.message}`);
    }
};
