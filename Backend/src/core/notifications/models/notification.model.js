import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        ownerType: {
            type: String,
            enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER'],
            required: true
            // No field-level index: ownerType is the leading key of both
            // compound indexes below, which already serve it.
        },
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        link: {
            type: String,
            default: '',
            trim: true
        },
        category: {
            type: String,
            default: 'broadcast',
            trim: true
        },
        source: {
            type: String,
            enum: ['ADMIN_BROADCAST', 'FSSAI_EXPIRY', 'SUPPORT_RESPONSE'],
            default: 'ADMIN_BROADCAST',
            index: true
        },
        broadcastId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'BroadcastNotification',
            default: null,
            index: true
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        isRead: {
            type: Boolean,
            default: false,
            index: true
        },
        readAt: {
            type: Date,
            default: null
        },
        dismissedAt: {
            type: Date,
            default: null,
            index: true
        }
    },
    {
        collection: 'food_notifications',
        timestamps: true
    }
);

notificationSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
notificationSchema.index({ ownerType: 1, ownerId: 1, isRead: 1, dismissedAt: 1 });
notificationSchema.index({ broadcastId: 1, ownerType: 1, ownerId: 1 }, { unique: true, sparse: true });

// Retention.
//
// This is by far the largest collection in the database — it was 26,016
// documents against 125 orders — and nothing ever deleted from it. A user's
// inbox is only useful for so long, and an unbounded notification table is
// the collection most likely to outgrow the box.
//
// Mongo's TTL monitor sweeps roughly once a minute and deletes in the
// background, so this costs nothing on the write path. Override the window
// with NOTIFICATION_RETENTION_DAYS; set it high rather than removing the
// index if you need longer retention, so the ceiling stays explicit.
// 180 days, not 90, on purpose. The oldest notification in production is
// ~130 days old, so 180 puts the ceiling in place and starts pruning
// naturally, whereas 90 would delete 6,246 existing notifications (24% of
// the collection) the first time the TTL monitor ran after deploy. Lower it
// once you have decided that history is genuinely disposable.
const RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS || 180);
notificationSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60, name: 'createdAt_ttl' },
);

export const FoodNotification = mongoose.model('FoodNotification', notificationSchema);
