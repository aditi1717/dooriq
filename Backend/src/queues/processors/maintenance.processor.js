import { logger } from '../../utils/logger.js';

/**
 * BullMQ processor for automated maintenance tasks.
 * @param {import('bullmq').Job} job
 */
export const processMaintenanceJob = async (job) => {
    const data = job?.data || {};
    const type = data.type || 'unknown';

    logger.info(`[BullMQ:maintenance] type=${type} jobId=${job.id}`);

    if (type === 'STALE_DELIVERY_PARTNER_SWEEP') {
        try {
            const { markStaleDeliveryPartnersOffline } = await import(
                '../../modules/food/delivery/services/delivery.service.js'
            );
            const result = await markStaleDeliveryPartnersOffline(data.staleMinutes);
            logger.info(
                `[BullMQ:maintenance] STALE_DELIVERY_PARTNER_SWEEP marked ${result.markedOffline} partner(s) offline ` +
                `(threshold ${result.staleMinutes}m)`,
            );
        } catch (err) {
            logger.error(`[BullMQ:maintenance] STALE_DELIVERY_PARTNER_SWEEP failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'FSSAI_EXPIRY_CHECK') {
        try {
            const { syncExpiredFssaiNotifications } = await import('../../modules/food/restaurant/services/fssaiExpiry.service.js');
            const results = await syncExpiredFssaiNotifications();
            logger.info(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK complete. Total Expired: ${results.totalExpired}, Notifications: ${results.createdCount}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK failed: ${err.message}`);
            throw err;
        }
    }

    return { processed: true, type, jobId: job.id };
};
