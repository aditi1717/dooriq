import express from 'express';
import {
    listConversationsController,
    listMessagesController,
    sendMessageController,
    markConversationReadController
} from '../controllers/chat.controller.js';

const router = express.Router();

router.get('/conversations', listConversationsController);
router.patch('/conversations/:conversationId/read', markConversationReadController);
router.get('/messages', listMessagesController);
router.post('/messages', sendMessageController);

export default router;
