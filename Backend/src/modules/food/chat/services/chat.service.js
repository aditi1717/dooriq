import mongoose from 'mongoose';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { FoodChatConversation } from '../models/chatConversation.model.js';
import { FoodChatMessage } from '../models/chatMessage.model.js';

const ROLES = ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'];

const normalizeRole = (role) => {
    const value = String(role || '').trim().toUpperCase();
    if (!ROLES.includes(value)) throw new ValidationError('peerRole is invalid');
    return value;
};

/** ADMIN is a desk, so support threads are keyed by the customer alone. */
const participantToken = (role, id) => (role === 'ADMIN' ? 'ADMIN' : `${role}:${id}`);

/**
 * Deterministic thread key. Participants are sorted so both sides compute the
 * same string regardless of who opens the conversation first.
 */
export const conversationKey = (a, b, orderId) => {
    const pair = [participantToken(a.role, a.id), participantToken(b.role, b.id)].sort();
    return `${orderId ? `order:${orderId}` : 'support'}|${pair.join('|')}`;
};

const isParticipant = (conversation, me) =>
    (conversation.participants || []).some(
        (p) => p.role === me.role && (p.role === 'ADMIN' || String(p.id) === String(me.id))
    );

const peerOf = (conversation, me) => {
    const participants = conversation.participants || [];
    const peer = participants.find(
        (p) => !(p.role === me.role && (p.role === 'ADMIN' || String(p.id) === String(me.id)))
    );
    return peer || participants[0] || { role: 'ADMIN', id: '' };
};

const shapeMessage = (message) => ({
    id: String(message._id),
    _id: String(message._id),
    conversationId: String(message.conversationId),
    orderId: message.orderId || null,
    senderRole: message.senderRole,
    senderId: message.senderId || '',
    recipientRole: message.recipientRole,
    recipientId: message.recipientId || '',
    text: message.text || '',
    readAt: message.readAt || null,
    createdAt: message.createdAt
});

/** Socket room the given party listens on. */
const roomFor = (role, id) => {
    if (role === 'USER') return rooms.user(id);
    if (role === 'DELIVERY_PARTNER') return rooms.delivery(id);
    if (role === 'RESTAURANT') return rooms.restaurant(id);
    return 'admin:orders';
};

/** Push delivery. Never throws — a dead socket must not fail the REST write. */
const emitToPeer = (event, role, id, payload) => {
    try {
        getIO().to(roomFor(role, id)).emit(event, payload);
    } catch (error) {
        logger.warn(`chat ${event} emit failed: ${error?.message || error}`);
    }
};

const findOrCreateConversation = async (me, peer, orderId, title) => {
    const key = conversationKey(me, peer, orderId);

    // Upsert rather than find-then-create: two devices sending the opening
    // message simultaneously would otherwise race into duplicate threads.
    await FoodChatConversation.updateOne(
        { key },
        {
            $setOnInsert: {
                key,
                participants: [
                    { role: me.role, id: me.role === 'ADMIN' ? '' : String(me.id) },
                    { role: peer.role, id: peer.role === 'ADMIN' ? '' : String(peer.id) }
                ],
                orderId: orderId || '',
                title: title || '',
                status: 'open'
            }
        },
        { upsert: true }
    );

    return FoodChatConversation.findOne({ key });
};

/** `GET /food/chat/conversations` — threads this caller takes part in. */
export const listConversations = async (me, query = {}) => {
    const filter = me.role === 'ADMIN'
        ? { 'participants.role': 'ADMIN' }
        : { participants: { $elemMatch: { role: me.role, id: String(me.id) } } };

    const orderId = String(query.orderId || '').trim();
    if (orderId) filter.orderId = orderId;

    const conversations = await FoodChatConversation.find(filter)
        .sort({ lastAt: -1, updatedAt: -1 })
        .limit(100)
        .lean();

    if (!conversations.length) return { conversations: [] };

    // One grouped count for the whole page rather than a query per thread.
    const unreadRows = await FoodChatMessage.aggregate([
        {
            $match: {
                conversationId: { $in: conversations.map((c) => c._id) },
                readAt: null,
                ...(me.role === 'ADMIN' ? { recipientRole: 'ADMIN' } : { recipientId: String(me.id) })
            }
        },
        { $group: { _id: '$conversationId', count: { $sum: 1 } } }
    ]);
    const unreadMap = new Map(unreadRows.map((row) => [String(row._id), row.count]));

    return {
        conversations: conversations.map((conversation) => {
            const peer = peerOf(conversation, me);
            return {
                conversationId: String(conversation._id),
                orderId: conversation.orderId || null,
                peerToken: participantToken(peer.role, peer.id),
                lastMessage: conversation.lastMessage || '',
                lastAt: conversation.lastAt,
                unread: unreadMap.get(String(conversation._id)) || 0,
                title: conversation.title || '',
                status: conversation.status || 'open',
                createdAt: conversation.createdAt,
                closedAt: conversation.closedAt || null
            };
        })
    };
};

/**
 * `GET /food/chat/messages` — one page of a thread, newest first.
 *
 * Reading a page also marks its incoming messages read, which is what keeps the
 * unread badge honest without the client having to call the read endpoint.
 */
export const listMessages = async (me, query = {}) => {
    const conversationId = String(query.conversationId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new ValidationError('conversationId is required');
    }

    const conversation = await FoodChatConversation.findById(conversationId).lean();
    if (!conversation) throw new NotFoundError('Conversation not found');
    if (!isParticipant(conversation, me)) throw new ForbiddenError('You are not part of this conversation');

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
    const filter = { conversationId: conversation._id };

    const [messages, total] = await Promise.all([
        FoodChatMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        FoodChatMessage.countDocuments(filter)
    ]);

    await markConversationRead(me, conversationId);

    return {
        messages: messages.map(shapeMessage),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1)
        }
    };
};

/** `POST /food/chat/messages`. */
export const sendMessage = async (me, payload = {}) => {
    const text = String(payload.text || '').trim();
    if (!text) throw new ValidationError('text is required');
    if (text.length > 2000) throw new ValidationError('Message is too long');

    const peerRole = normalizeRole(payload.peerRole);
    const peerId = String(payload.peerId || '').trim();
    const orderId = String(payload.orderId || '').trim();

    // Support chat goes to the admin desk and needs no peer id; anything else
    // is a conversation with one specific counterpart, which does.
    if (peerRole !== 'ADMIN' && !peerId) {
        throw new ValidationError('peerId is required for this conversation');
    }

    const peer = { role: peerRole, id: peerId };
    const conversation = await findOrCreateConversation(me, peer, orderId, payload.title);

    const message = await FoodChatMessage.create({
        conversationId: conversation._id,
        orderId: conversation.orderId || '',
        senderRole: me.role,
        senderId: me.role === 'ADMIN' ? '' : String(me.id),
        recipientRole: peerRole,
        recipientId: peerRole === 'ADMIN' ? '' : peerId,
        text
    });

    conversation.lastMessage = text;
    conversation.lastAt = message.createdAt;
    // A reply reopens a thread the desk had closed, rather than stranding the
    // user in a conversation that accepts messages nobody is watching.
    if (conversation.status === 'closed') {
        conversation.status = 'open';
        conversation.closedAt = null;
    }
    await conversation.save();

    const shaped = shapeMessage(message);
    emitToPeer('chat:message', peerRole, peerId, shaped);

    return { message: shaped };
};

/** `PATCH /food/chat/conversations/:id/read` → `{ updated }`. */
export const markConversationRead = async (me, conversationId) => {
    const id = String(conversationId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('conversationId is invalid');

    const conversation = await FoodChatConversation.findById(id).lean();
    if (!conversation) throw new NotFoundError('Conversation not found');
    if (!isParticipant(conversation, me)) throw new ForbiddenError('You are not part of this conversation');

    const result = await FoodChatMessage.updateMany(
        {
            conversationId: conversation._id,
            readAt: null,
            ...(me.role === 'ADMIN' ? { recipientRole: 'ADMIN' } : { recipientId: String(me.id) })
        },
        { $set: { readAt: new Date() } }
    );

    return { updated: result.modifiedCount || 0 };
};
