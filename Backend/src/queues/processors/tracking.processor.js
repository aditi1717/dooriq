import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { logger } from '../../utils/logger.js';
import { connectDB } from '../../config/db.js';
import { getRedisClient } from '../../config/redis.js';

let isDBConnected = false;

const ensureDB = async () => {
    if (isDBConnected) return;
    await connectDB();
    isDBConnected = true;
};

/**
 * Syncs the latest location from "HOT" Redis storage to "COLD" MongoDB storage.
 */
export const processTrackingJob = async (job) => {
    await ensureDB();
    const { name, data } = job;

    if (name === 'sync-hot-locations') {
        return await handleHotSync(data);
    }
    return null;
};

const handleHotSync = async ({ userId, orderId }) => {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        // Fetch the absolute latest rider location from Redis. Order tracking
        // stays in Firebase RTDB only, so customer map updates do not persist
        // moving coordinates into MongoDB.
        const riderRaw = await redis.hGet('rider:locations:hot', String(userId));

        const riderData = riderRaw ? JSON.parse(riderRaw) : null;

        const updates = [];

        if (riderData && userId) {
            updates.push(
                FoodDeliveryPartner.findByIdAndUpdate(userId, {
                    $set: {
                        lastLocation: {
                            type: 'Point',
                            coordinates: [riderData.lng, riderData.lat]
                        },
                        // Order dispatch scores riders on lastLat/lastLng and
                        // treats a stale lastLocationAt as "no GPS". Syncing only
                        // the GeoJSON field left dispatch reading an old position.
                        lastLat: riderData.lat,
                        lastLng: riderData.lng,
                        lastLocationAt: riderData.timestamp
                            ? new Date(riderData.timestamp)
                            : new Date()
                    }
                })
            );
        }

        if (updates.length > 0) {
            await Promise.all(updates);
            // One line per rider per sync window. At a few thousand active riders
            // that is a constant stream into a log file nothing rotates, so it
            // sits at debug alongside the other per-ping tracing.
            logger.debug(`Synced hot rider availability location to MongoDB for Rider ${userId}`);
        }
    } catch (err) {
        logger.error(`Failed to handle hot sync for ${orderId}: ${err.message}`);
        throw err;
    }
};
