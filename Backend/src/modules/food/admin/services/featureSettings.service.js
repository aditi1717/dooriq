import { FoodFeatureSetting } from '../models/featureSetting.model.js';
import { createTtlCache, once } from '../../../../utils/cache.js';

export const FEATURE_KEYS = {
    RESTAURANT_SUBSCRIPTION: 'restaurant_subscription',
    COD_CONTROL: 'cod_control',
    ADMIN_ACCESS_SECTION: 'admin_access_section',
    ROOT_LANDING_AND_UNREGISTERED_CONTROL: 'root_landing_and_unregistered_control',
    LIVE_GEOLOCATION: 'live_geolocation'
};

const DEFAULT_FEATURES = [
    {
        key: FEATURE_KEYS.RESTAURANT_SUBSCRIPTION,
        name: 'Restaurant Subscription',
        description: 'Controls restaurant onboarding payment, subscription dues checks, and subscription settings UI.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.COD_CONTROL,
        name: 'Cash On Delivery (COD)',
        description: 'Controls COD option visibility and delivery cash-limit related UI sections.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.ADMIN_ACCESS_SECTION,
        name: 'Admin Access Section',
        description: 'Controls visibility of the Admin Access section (including Sub Admin List) in admin panel sidebar.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL,
        name: 'Root Landing & Unregistered Restaurants',
        description: 'Controls root URL behavior and Unregistered Restaurants visibility. When disabled, root redirects to /food/user and Unregistered Restaurants is hidden.',
        isEnabled: true
    },
    {
        key: FEATURE_KEYS.LIVE_GEOLOCATION,
        name: 'Live Geolocation',
        description: 'When enabled, the app fetches the user\'s live location on load. When disabled, it defaults to Vijay Nagar, Indore.',
        isEnabled: true
    }
];

/**
 * `/feature-settings/public` is fetched on nearly every page load. Reading it
 * used to seed five default rows first - five sequential round-trips per
 * request - which is what made the endpoint take 3-4 seconds under load.
 *
 * Seeding is idempotent bootstrap work, so it now runs once per process as a
 * single bulk write, and the resulting list is served from a short-lived cache.
 */
const featureSettingsCache = createTtlCache({ ttlMs: 30_000, maxEntries: 4, name: 'feature-settings' });
const LIST_CACHE_KEY = 'all';

const seedDefaultFeatureSettings = once(async () => {
    await FoodFeatureSetting.bulkWrite(
        DEFAULT_FEATURES.map((feature) => ({
            updateOne: {
                filter: { key: feature.key },
                update: { $setOnInsert: feature },
                upsert: true
            }
        })),
        { ordered: false }
    );
});

export async function ensureDefaultFeatureSettings() {
    await seedDefaultFeatureSettings();
}

const toFeatureDto = (doc) => ({
    key: doc.key,
    name: doc.name,
    description: doc.description || '',
    isEnabled: Boolean(doc.isEnabled),
    updatedAt: doc.updatedAt
});

async function loadFeatureSettings() {
    await ensureDefaultFeatureSettings();
    const docs = await FoodFeatureSetting.find({}).sort({ createdAt: 1 }).lean();
    return docs.map(toFeatureDto);
}

export async function listFeatureSettings() {
    return featureSettingsCache.get(LIST_CACHE_KEY, loadFeatureSettings);
}

export function invalidateFeatureSettingsCache() {
    featureSettingsCache.clear();
}

export async function updateFeatureSetting(key, payload = {}) {
    await ensureDefaultFeatureSettings();
    const nextEnabled = Boolean(payload?.isEnabled);
    const updated = await FoodFeatureSetting.findOneAndUpdate(
        { key: String(key || '').trim() },
        { $set: { isEnabled: nextEnabled } },
        { new: true }
    ).lean();

    // Drop the cached list so this worker serves the new value immediately.
    invalidateFeatureSettingsCache();

    return updated ? toFeatureDto(updated) : null;
}

export async function isFeatureEnabled(key, fallback = true) {
    if (!key) return fallback;
    const features = await listFeatureSettings();
    const match = features.find((feature) => feature.key === String(key).trim());
    if (!match) return fallback;
    return Boolean(match.isEnabled);
}
