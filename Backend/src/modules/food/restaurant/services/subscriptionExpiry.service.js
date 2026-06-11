import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';
import { getRestaurantSubscriptionSettings } from '../../admin/services/admin.service.js';
import { getRestaurantGmvLast30Days, resolvePlanPricingFromEligibility } from './subscriptionPlan.service.js';
import { logRestaurantSubscriptionHistory } from './subscriptionHistory.service.js';

/**
 * Service to handle subscription renewals and debt accumulation.
 * This should be called by a daily cron job.
 */
export const processSubscriptionExpiries = async () => {
    const now = new Date();
    
    // Find all restaurants whose subscription has expired
    const expiredRestaurants = await FoodRestaurant.find({
        status: 'approved',
        subscriptionValidTill: { $lt: now }
    });

    console.log(`[SUBSCRIPTION] Found ${expiredRestaurants.length} expired subscriptions to process.`);

    const results = {
        processed: 0,
        errors: 0
    };

    for (const restaurant of expiredRestaurants) {
        try {
            const settings = await getRestaurantSubscriptionSettings();
            const { planName, baseAmount: planBase } = await resolvePlanPricingFromEligibility(restaurant._id, settings);
            const planGST = Math.round(planBase * 0.18);
            const renewalTotal = planBase + planGST;

            // 2. Update the restaurant record
            // Add new month's fee to the due amount
            const oldDue = Number(restaurant.subscriptionDueAmount || 0);
            const paidBefore = Number(restaurant.subscriptionPaidAmount || 0);
            const newDue = oldDue + renewalTotal;
            
            // Set new expiry for next month
            const currentExpiry = new Date(restaurant.subscriptionValidTill || now);
            const nextExpiry = new Date(currentExpiry);
            nextExpiry.setMonth(nextExpiry.getMonth() + 1);

            restaurant.subscriptionDueAmount = newDue;
            restaurant.subscriptionAmount = (restaurant.subscriptionAmount || 0) + renewalTotal;
            restaurant.subscriptionValidTill = nextExpiry;
            restaurant.subscriptionStatus = 'due';
            restaurant.subscriptionPlan = planName;

            await restaurant.save();
            const gmvLast30Days = await getRestaurantGmvLast30Days(restaurant._id);
            await logRestaurantSubscriptionHistory({
                restaurantId: restaurant._id,
                eventType: 'subscription_renewal_due_added',
                plan: planName,
                amount: renewalTotal,
                dueBefore: oldDue,
                dueAfter: newDue,
                paidBefore,
                paidAfter: Number(restaurant.subscriptionPaidAmount || 0),
                gmvLast30Days,
                note: 'Renewal cycle due added automatically after subscription expiry',
            }).catch(() => null);

            // 3. Notify the owner
            const message = `Your subscription for "${restaurant.restaurantName}" has been renewed. An amount of ₹${renewalTotal} has been added to your dues. Total due: ₹${newDue}.`;
            
            await FoodNotification.create({
                ownerType: 'RESTAURANT',
                ownerId: restaurant._id,
                title: 'Subscription Renewed',
                message,
                category: 'billing',
                source: 'SUBSCRIPTION_RENEWAL'
            });

            await notifyOwnerSafely(
                { ownerType: 'RESTAURANT', ownerId: restaurant._id },
                {
                    title: 'Subscription Renewed 💳',
                    body: message,
                    data: {
                        type: 'subscription_renewed',
                        restaurantId: String(restaurant._id),
                        newDueAmount: String(newDue)
                    }
                }
            );

            results.processed++;
        } catch (err) {
            console.error(`[SUBSCRIPTION] Error processing restaurant ${restaurant._id}:`, err);
            results.errors++;
        }
    }

    return results;
};
