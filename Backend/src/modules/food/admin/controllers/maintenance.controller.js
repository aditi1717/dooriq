import { sendResponse } from '../../../../utils/response.js';
import {
    getMaintenanceState,
    updateMaintenanceSettings,
} from '../services/maintenance.service.js';

/**
 * Public maintenance status.
 *
 * Read by the maintenance screen so it can show the admin's own message and
 * the expected end time, and by each app on load so it can route straight to
 * that screen instead of waiting for a 503 on the first real call.
 *
 * Must stay exempt in maintenanceGuard — a status endpoint that is itself
 * unavailable during an outage is useless.
 */
export const getPublicMaintenanceStatusController = async (req, res, next) => {
    try {
        const state = await getMaintenanceState();
        // Only what a public caller needs. `isEnabled` is withheld: whether a
        // future window is scheduled is operational detail, not public.
        return sendResponse(res, 200, 'Maintenance status fetched successfully', {
            active: state.active,
            message: state.active ? state.message : '',
            endsAt: state.active ? state.endsAt : null,
        });
    } catch (error) {
        next(error);
    }
};

/** Admin read — includes the scheduled window whether or not it is live yet. */
export const getMaintenanceSettingsController = async (req, res, next) => {
    try {
        return sendResponse(
            res,
            200,
            'Maintenance settings fetched successfully',
            await getMaintenanceState(),
        );
    } catch (error) {
        next(error);
    }
};

export const updateMaintenanceSettingsController = async (req, res, next) => {
    try {
        const state = await updateMaintenanceSettings(req.body, req.user?.userId || null);
        return sendResponse(res, 200, 'Maintenance settings updated successfully', state);
    } catch (error) {
        next(error);
    }
};
