import { sendResponse } from '../../../../utils/response.js';
import * as chatService from '../services/chat.service.js';

/** Identity of the caller, as the chat service expects it. */
const requester = (req) => ({ role: req.user?.role, id: String(req.user?.userId || '') });

export const listConversationsController = async (req, res, next) => {
    try {
        const data = await chatService.listConversations(requester(req), req.query);
        return sendResponse(res, 200, 'Conversations fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listMessagesController = async (req, res, next) => {
    try {
        const data = await chatService.listMessages(requester(req), req.query);
        return sendResponse(res, 200, 'Messages fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const sendMessageController = async (req, res, next) => {
    try {
        const data = await chatService.sendMessage(requester(req), req.body || {});
        return sendResponse(res, 201, 'Message sent successfully', data);
    } catch (error) {
        next(error);
    }
};

export const markConversationReadController = async (req, res, next) => {
    try {
        const data = await chatService.markConversationRead(requester(req), req.params.conversationId);
        return sendResponse(res, 200, 'Conversation marked as read', data);
    } catch (error) {
        next(error);
    }
};
