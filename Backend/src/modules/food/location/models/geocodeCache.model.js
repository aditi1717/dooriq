import mongoose from 'mongoose';

/**
 * Persistent reverse-geocode cache.
 *
 * A street address for a fixed coordinate does not meaningfully change, so this
 * is stored rather than held in a TTL cache: the platform pays Google once per
 * ~11 m grid cell, ever, instead of once per lookup.
 *
 * Persistent also matters because the API runs in PM2 cluster mode — an
 * in-process cache would be duplicated per worker and lost on every restart.
 */
const geocodeCacheSchema = new mongoose.Schema(
    {
        /** "<lat>,<lng>" rounded to 4dp (~11 m). See buildGeocodeKey(). */
        key: { type: String, required: true, unique: true, index: true },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        /** Normalized payload returned to clients. */
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        country: { type: String, default: '' },
        area: { type: String, default: '' },
        address: { type: String, default: '' },
        formattedAddress: { type: String, default: '' },
        /** Which upstream produced this row, for observability. */
        provider: { type: String, default: 'google' },
        hits: { type: Number, default: 0 }
    },
    { collection: 'food_geocode_cache', timestamps: true }
);

export const FoodGeocodeCache = mongoose.model('FoodGeocodeCache', geocodeCacheSchema);
