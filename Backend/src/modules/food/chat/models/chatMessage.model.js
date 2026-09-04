import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
    {
        conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodChatConversation', required: true, index: true },
        orderId: { type: String, default: '', trim: true },
        senderRole: { type: String, required: true },
        senderId: { type: String, default: '', trim: true },
        recipientRole: { type: String, required: true },
        recipientId: { type: String, default: '', trim: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        readAt: { type: Date, default: null }
    },
    { collection: 'food_chat_messages', timestamps: true }
);

// Thread paging, newest first.
chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
// Unread badge: "messages addressed to me that I have not read".
chatMessageSchema.index({ recipientId: 1, readAt: 1 });

export const FoodChatMessage = mongoose.model('FoodChatMessage', chatMessageSchema);
