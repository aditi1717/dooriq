import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import {
    getCachedBusinessSettings,
    invalidateBusinessSettingsCache,
} from '../controllers/businessSettings.controller.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Maintenance mode.
 *
 * The stored shape is a switch plus an optional window (see the `maintenance`
 * block in businessSettings.model.js). This module is the single place that
 * turns those fields into the one question every caller actually has: is the
 * site down right now?
 *
 * Deriving that from a window rather than flipping a boolean on a timer means
 * no scheduled job has to survive for the site to come back up, and every API
 * worker reaches the same verdict from the same document.
 */

const DEFAULT_MESSAGE =
    'We are carrying out scheduled maintenance and will be back shortly. Thanks for your patience.';

const asDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * @param {{ isEnabled?: boolean, startsAt?: Date|string|null, endsAt?: Date|string|null }} m
 * @param {Date} [now]
 * @returns {boolean}
 */
export const isMaintenanceActive = (m, now = new Date()) => {
    if (!m?.isEnabled) return false;

    const startsAt = asDate(m.startsAt);
    const endsAt = asDate(m.endsAt);

    // Scheduled for later: enabled, but the window has not opened.
    if (startsAt && now < startsAt) return false;
    // Window has closed. The switch is left as-is deliberately — an admin can
    // see that a window was set and has passed, rather than finding the toggle
    // silently off.
    if (endsAt && now >= endsAt) return false;

    return true;
};

/**
 * Current maintenance state, for the public status endpoint and the guard.
 *
 * Reads through the business-settings cache (30s TTL), so this costs nothing
 * on the request path. 30 seconds is the worst-case delay between an admin
 * saving and every worker agreeing, which is an acceptable trade for not
 * querying Mongo on every single request.
 */
export const getMaintenanceState = async (now = new Date()) => {
    const settings = await getCachedBusinessSettings();
    const m = settings?.maintenance || {};
    const active = isMaintenanceActive(m, now);

    return {
        active,
        // `isEnabled` and `active` differ while a window is pending or spent,
        // which is exactly what the admin UI needs to explain the state.
        isEnabled: Boolean(m.isEnabled),
        message: (m.message || '').trim() || DEFAULT_MESSAGE,
        startsAt: asDate(m.startsAt),
        endsAt: asDate(m.endsAt),
    };
};

/**
 * Validate and persist a maintenance change.
 *
 * @param {{ isEnabled?: unknown, message?: unknown, startsAt?: unknown, endsAt?: unknown }} payload
 * @param {string|null} [adminId]
 */
export const updateMaintenanceSettings = async (payload = {}, adminId = null) => {
    const settings = await FoodBusinessSettings.findOne().select('_id maintenance').lean();
    if (!settings) throw new ValidationError('Business settings not initialised');

    const current = settings.maintenance || {};
    const next = {
        isEnabled:
            payload.isEnabled === undefined
                ? Boolean(current.isEnabled)
                : Boolean(payload.isEnabled),
        message:
            payload.message === undefined
                ? current.message || ''
                : String(payload.message).trim().slice(0, 500),
        startsAt: payload.startsAt === undefined ? asDate(current.startsAt) : asDate(payload.startsAt),
        endsAt: payload.endsAt === undefined ? asDate(current.endsAt) : asDate(payload.endsAt),
    };

    // A caller that sends a value we could not parse gets told, rather than
    // having it silently become "no bound" — the difference between those two
    // is the difference between a 30-minute window and an indefinite outage.
    if (payload.startsAt && !next.startsAt) throw new ValidationError('startsAt is not a valid date');
    if (payload.endsAt && !next.endsAt) throw new ValidationError('endsAt is not a valid date');

    if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) {
        throw new ValidationError('The maintenance window must end after it starts');
    }
    if (next.isEnabled && next.endsAt && !next.startsAt && next.endsAt <= new Date()) {
        throw new ValidationError('That end time is already in the past');
    }

    await FoodBusinessSettings.updateOne(
        { _id: settings._id },
        {
            $set: {
                'maintenance.isEnabled': next.isEnabled,
                'maintenance.message': next.message,
                'maintenance.startsAt': next.startsAt,
                'maintenance.endsAt': next.endsAt,
                'maintenance.updatedBy': adminId || null,
                'maintenance.updatedAt': new Date(),
            },
        },
    );

    // Without this the admin's own next read could still show the old value
    // for up to the cache TTL, which reads as "the save did not work".
    invalidateBusinessSettingsCache();

    return getMaintenanceState();
};
