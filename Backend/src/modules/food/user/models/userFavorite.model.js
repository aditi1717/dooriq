import mongoose from 'mongoose';

/**
 * One row per (user, entity) pair rather than arrays on the user document:
 * favouriting is a high-churn write, and a unique compound index makes the
 * toggle idempotent without read-modify-write.
 */
const userFavoriteSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        entityType: { type: String, enum: ['restaurant', 'food'], required: true },
        entityId: { type: mongoose.Schema.Types.ObjectId, required: true }
    },
    { collection: 'food_user_favorites', timestamps: true }
);

userFavoriteSchema.index({ userId: 1, entityType: 1, entityId: 1 }, { unique: true });

export const FoodUserFavorite = mongoose.model('FoodUserFavorite', userFavoriteSchema);
