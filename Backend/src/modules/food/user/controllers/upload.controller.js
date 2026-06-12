import { sendResponse } from '../../../../utils/response.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export async function uploadGenericImageController(req, res, next) {
    try {
        if (!req.file) throw new ValidationError('File is required');
        const url = await uploadImageBuffer(req.file.buffer, 'food/users/uploads');
        return sendResponse(res, 200, 'Image uploaded successfully', { url });
    } catch (err) {
        next(err);
    }
}
