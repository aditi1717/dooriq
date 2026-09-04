import { config } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Startup validation for environment configuration.
 *
 * Two tiers, because the failure they prevent is different:
 *
 *   FATAL    — the process cannot do its job at all without these, so refuse
 *              to boot rather than accept traffic and fail per-request.
 *
 *   DEGRADED — a feature silently stops working. These do not stop the boot,
 *              because a missing SMTP password should not take the platform
 *              offline, but they are reported once, loudly, at startup.
 *
 * The second tier exists because of two real incidents. FIREBASE_DATABASE_URL
 * was absent, so live tracking wrote to nothing and the only evidence was
 * "Can't determine Firebase Database URL" buried in an error log. Google Maps
 * failed 56,613 times for weeks with nothing surfacing at boot. Both would have
 * been a single startup line under this check.
 *
 * Set STRICT_ENV=true to promote DEGRADED to FATAL — worth doing in staging so
 * a missing variable is caught before it reaches production.
 */

const isProduction = () => config.nodeEnv === 'production';

/** Feature groups: all-or-nothing sets where a partial config is the real bug. */
const featureGroups = [
    {
        feature: 'Firebase (push notifications + live tracking)',
        // The service account can arrive as a path or inline JSON; either is fine.
        keys: [
            ['FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH',
                config.firebaseServiceAccount || config.firebaseServiceAccountPath],
            ['FIREBASE_PROJECT_ID', config.firebaseProjectId],
        ],
    },
    {
        feature: 'Firebase Realtime Database (rider location fan-out)',
        keys: [['FIREBASE_DATABASE_URL', config.firebaseDatabaseUrl]],
    },
    {
        feature: 'Google Maps (geocoding + directions)',
        keys: [['GOOGLE_MAPS_API_KEY', config.googleMapsApiKey]],
    },
    {
        feature: 'Razorpay (payments)',
        keys: [
            ['RAZORPAY_KEY_ID', config.razorpayKeyId],
            ['RAZORPAY_KEY_SECRET', config.razorpayKeySecret],
            ['RAZORPAY_WEBHOOK_SECRET', config.razorpayWebhookSecret],
        ],
    },
    {
        feature: 'Cloudinary (image uploads)',
        keys: [
            ['CLOUDINARY_CLOUD_NAME', config.cloudinaryCloudName],
            ['CLOUDINARY_API_KEY', config.cloudinaryApiKey],
            ['CLOUDINARY_API_SECRET', config.cloudinaryApiSecret],
        ],
    },
    {
        feature: 'SMS India Hub (OTP delivery)',
        keys: [
            ['SMS_INDIA_HUB_USERNAME', config.smsIndiaHubUsername],
            ['SMS_INDIA_HUB_API_KEY', config.smsApiKey],
            ['SMS_INDIA_HUB_SENDER_ID', config.smsSenderId],
        ],
    },
    {
        feature: 'SMTP email (admin password reset)',
        keys: [
            ['EMAIL_HOST', config.emailHost],
            ['EMAIL_USER', config.emailUser],
            ['EMAIL_PASS', config.emailPass],
        ],
    },
];

export const validateConfig = () => {
    const fatal = [];

    if (!config.mongodbUri) fatal.push('MONGO_URI or MONGODB_URI');
    if (!config.jwtAccessSecret) fatal.push('JWT_ACCESS_SECRET or JWT_SECRET');
    if (!config.jwtRefreshSecret) fatal.push('JWT_REFRESH_SECRET');
    if (config.redisEnabled && !config.redisUrl) {
        fatal.push('REDIS_URL (required when REDIS_ENABLED=true)');
    }
    if (config.bullmqEnabled && !config.redisEnabled) {
        fatal.push('REDIS_ENABLED=true (required when BULLMQ_ENABLED=true)');
    }

    // A JWT secret that survived from a template is worse than a missing one:
    // it boots cleanly and every token it signs is forgeable.
    const weakSecrets = ['secret', 'changeme', 'your-secret-key', 'mysecret123'];
    for (const [name, value] of [
        ['JWT_ACCESS_SECRET', config.jwtAccessSecret],
        ['JWT_REFRESH_SECRET', config.jwtRefreshSecret],
    ]) {
        if (!value) continue;
        if (weakSecrets.includes(String(value).toLowerCase()) || String(value).length < 16) {
            const msg = `${name} is weak (placeholder or under 16 characters)`;
            if (isProduction()) fatal.push(msg);
            else logger.warn(`Config: ${msg}`);
        }
    }

    if (fatal.length > 0) {
        logger.error(`Missing required environment variables: ${fatal.join(', ')}`);
        process.exit(1);
    }

    // ─── Degraded features ───────────────────────────────────────────────
    //
    // Reported per feature rather than per variable, so the log line says what
    // will actually stop working rather than naming a key nobody recognises.

    const strict = String(process.env.STRICT_ENV || '').toLowerCase() === 'true';
    const degraded = [];

    for (const group of featureGroups) {
        const missing = group.keys.filter(([, value]) => !value).map(([name]) => name);
        if (missing.length === 0) continue;
        const partial = missing.length < group.keys.length;
        degraded.push({ feature: group.feature, missing, partial });
    }

    if (degraded.length === 0) return;

    for (const d of degraded) {
        // A partially configured feature is nearly always a mistake, where a
        // wholly absent one may well be deliberate. Say which this is.
        const shape = d.partial ? 'PARTIALLY configured' : 'not configured';
        logger.warn(`Config: ${d.feature} is ${shape} — missing ${d.missing.join(', ')}`);
    }

    if (strict) {
        logger.error(`STRICT_ENV=true and ${degraded.length} feature(s) are incompletely configured. Refusing to start.`);
        process.exit(1);
    }

    // Partial configuration is the shape that caused both prior incidents, so
    // it is called out again in production even when not running strict.
    const partials = degraded.filter((d) => d.partial);
    if (partials.length > 0 && isProduction()) {
        logger.error(
            `Config: ${partials.length} feature(s) are partially configured and WILL fail at runtime: ` +
            partials.map((d) => d.feature).join('; ') +
            '. Set STRICT_ENV=true to make this fatal.',
        );
    }
};
