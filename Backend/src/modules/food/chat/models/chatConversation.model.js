import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
    {
        role: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'], required: true },
        /** Empty for ADMIN — support is a desk, not one person. */
        id: { type: String, default: '', trim: true }
    },
    { _id: false }
);

/**
 * A thread between exactly two parties.
 *
 * Participants are stored as a pair rather than as `userId` + `peerId` so the
 * same document serves the customer app, the rider app and the admin desk —
 * each of them derives "the other side" from its own identity at read time.
 */
const chatConversationSchema = new mongoose.Schema(
    {
        /**
         * Deterministic identity for the thread, so two devices sending the
         * first message at once converge on one conversation instead of two.
         */
        key: { type: String, required: true, unique: true, index: true },
        participants: { type: [participantSchema], required: true },
        /** Set for order chats, absent for support threads. */
        orderId: { type: String, default: '', trim: true, index: true },
        /** Subject the user picked when opening a support thread. */
        title: { type: String, default: '', trim: true },
        status: { type: String, enum: ['open', 'in_progress', 'closed'], default: 'open', index: true },
        lastMessage: { type: String, default: '', trim: true },
        lastAt: { type: Date, default: null },
        closedAt: { type: Date, default: null }
    },
    { collection: 'food_chat_conversations', timestamps: true }
);

chatConversationSchema.index({ 'participants.id': 1, lastAt: -1 });

export const FoodChatConversation = mongoose.model('FoodChatConversation', chatConversationSchema);
