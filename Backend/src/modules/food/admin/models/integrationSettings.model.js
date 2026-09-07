import mongoose from 'mongoose';

/**
 * Third-party credentials that an admin can rotate without a redeploy.
 *
 * Deliberately a separate collection from `food_business_settings`, which is
 * served in full by `GET /business-settings/public` — an unauthenticated
 * endpoint. Anything stored there is public by definition, so a secret cannot
 * live in it. This document is only ever read server-side or through an
 * admin-authenticated route that masks the value.
 *
 * Singleton: one document, found with `findOne()`. `key` exists so that
 * constraint is enforced by the database rather than by convention.
 */
const integrationSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: 'global',
            unique: true,
            immutable: true,
        },

        googleMaps: {
            /**
             * Server-side Google Maps key used for geocoding and directions.
             * Empty means "fall back to GOOGLE_MAPS_API_KEY from the
             * environment", so adding this feature cannot break a working
             * deployment that has never opened the admin screen.
             */
            apiKey: { type: String, default: '' },
            updatedAt: { type: Date, default: null },
            updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', default: null },
        },
    },
    {
        timestamps: true,
        collection: 'food_integration_settings',
    },
);

export const FoodIntegrationSettings = mongoose.model(
    'FoodIntegrationSettings',
    integrationSettingsSchema,
);
