import mongoose from 'mongoose';
import { FoodSupportTicket } from '../models/supportTicket.model.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { getIO } from '../../../../config/socket.js';
import { notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';

export async function createSupportTicketController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const body = req.body || {};
        const type = String(body.type || '').trim();
        const issueType = String(body.issueType || '').trim();
        const description = String(body.description || '').trim();
        if (!['order', 'restaurant', 'other'].includes(type)) {
            return sendError(res, 400, 'Invalid ticket type');
        }
        if (!issueType) return sendError(res, 400, 'issueType required');
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendError(res, 401, 'Unauthorized or invalid user');
        }
        const doc = {
            userId: new mongoose.Types.ObjectId(userId),
            type,
            issueType,
            description
        };
        if (type === 'order') {
            if (!body.orderId || !mongoose.Types.ObjectId.isValid(body.orderId)) {
                return sendError(res, 400, 'orderId required');
            }
            const orderMongoId = new mongoose.Types.ObjectId(body.orderId);
            doc.orderId = orderMongoId;
            // Also try to link restaurantId automatically if possible
            const { FoodOrder } = await import('../../orders/models/order.model.js');
            const order = await FoodOrder.findById(orderMongoId).select('restaurantId').lean();
            if (order?.restaurantId) {
                doc.restaurantId = order.restaurantId;
            }
        }
        if (type === 'restaurant') {
            if (!body.restaurantId || !mongoose.Types.ObjectId.isValid(body.restaurantId)) {
                return sendError(res, 400, 'restaurantId required');
            }
            doc.restaurantId = new mongoose.Types.ObjectId(body.restaurantId);
        }
        const created = await FoodSupportTicket.create(doc);

        const ticketId = String(created?._id || '');
        const adminPayload = {
            title: 'New support ticket received',
            body: `${type === 'order' ? 'Order' : type === 'restaurant' ? 'Restaurant' : 'General'} support ticket raised for ${issueType}.`,
            message: `${type === 'order' ? 'Order' : type === 'restaurant' ? 'Restaurant' : 'General'} support ticket raised for ${issueType}.`,
            type: 'support',
            category: 'support',
            source: 'SUPPORT_TICKET',
            ticketId,
            userId: String(userId),
            issueType,
            ticketType: type,
            orderId: body.orderId ? String(body.orderId) : null,
            restaurantId: doc.restaurantId ? String(doc.restaurantId) : null,
            path: '/admin/food/support-tickets',
            createdAt: created?.createdAt || new Date().toISOString()
        };

        try {
            const io = getIO();
            if (io) {
                io.to('admin:orders').emit('admin_notification', adminPayload);
            }
        } catch (socketError) {
            console.error('Error emitting admin support ticket socket notification:', socketError);
        }

        await notifyAdminsSafely({
            title: adminPayload.title,
            body: adminPayload.body,
            data: {
                type: 'SUPPORT_TICKET',
                ticketId,
                source: 'user',
                ticketType: type,
                issueType,
                orderId: adminPayload.orderId || undefined,
                restaurantId: adminPayload.restaurantId || undefined,
                path: adminPayload.path
            }
        }).catch((pushError) => {
            console.error('Error sending admin support ticket push notification:', pushError);
        });

        return sendResponse(res, 201, 'Ticket created', { ticket: created.toObject() });
    } catch (e) {
        next(e);
    }
}

export async function listMySupportTicketsController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 20, 1), 50);
        const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
        const skip = (page - 1) * limit;
        const [tickets, total] = await Promise.all([
            FoodSupportTicket.find({ userId: new mongoose.Types.ObjectId(userId) })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            FoodSupportTicket.countDocuments({ userId: new mongoose.Types.ObjectId(userId) })
        ]);
        return sendResponse(res, 200, 'Tickets fetched', { tickets, total, page, limit });
    } catch (e) {
        next(e);
    }
}
