import { FoodReferralLog } from '../../modules/food/admin/models/referralLog.model.js';
import { FoodReferralSettings } from '../../modules/food/admin/models/referralSettings.model.js';
import { FoodUser } from '../users/user.model.js';
import { creditReferralReward } from '../../modules/food/user/services/userWallet.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Referral settlement.
 *
 * A referral is recorded when someone signs up with a code, but it is not paid
 * then. It is paid when the referred person actually completes an order.
 *
 * The previous behaviour credited the referrer's wallet during registration and
 * wrote the log row as already settled. That made the reward free money for
 * anyone willing to create throwaway accounts against their own code, and it
 * did not match the rule the business asked for. The per-user limit capped the
 * loss per account but did not prevent it.
 *
 * Everything here is keyed on the unique (refereeId, role) index on the log, so
 * a person can only ever qualify one referral, no matter how many orders they
 * place or how many times this runs.
 */

/**
 * Referrals that actually paid out. This is what a referral limit should count:
 * the business rule is "reward the first N successful referrals", and a
 * registration is not a success.
 *
 * @param {import('mongoose').Types.ObjectId|string} referrerId
 * @param {'USER'|'DELIVERY_PARTNER'} role
 * @returns {Promise<number>}
 */
export const countSettledReferrals = async (referrerId, role) => {
    if (!referrerId) return 0;
    return FoodReferralLog.countDocuments({ referrerId, role, status: 'credited' });
};

/**
 * Pay a referral now that the referred user has completed an order.
 *
 * Safe to call on every delivered order: the claim below only succeeds for a
 * row still in `pending`, so later orders by the same person are no-ops.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId  the referred user
 * @param {import('mongoose').Types.ObjectId|string} orderId the qualifying order
 * @returns {Promise<{settled: boolean, reason?: string, reward?: number}>}
 */
export const settleUserReferralOnDelivery = async (userId, orderId) => {
    if (!userId) return { settled: false, reason: 'no_user' };

    const pending = await FoodReferralLog.findOne({
        refereeId: userId,
        role: 'USER',
        status: 'pending',
    }).lean();

    if (!pending) return { settled: false, reason: 'no_pending_referral' };

    // Re-check the limit at settlement, not just at signup. Referrals settle in
    // completion order rather than signup order, so a referrer holding more
    // pending referrals than their limit allows must not exceed it just because
    // several referees ordered on the same day.
    //
    // The limit is read live rather than frozen on the row: it is a policy
    // control the admin is expected to change. The reward *amounts* are frozen,
    // because those were promised at referral time.
    const settings = await FoodReferralSettings.findOne({ isActive: true })
        .sort({ createdAt: -1 })
        .select('referralLimitUser')
        .lean();

    const settledCount = await countSettledReferrals(pending.referrerId, 'USER');
    const limit = Math.max(0, Number(settings?.referralLimitUser) || 0);
    if (limit > 0 && settledCount >= limit) {
        await FoodReferralLog.updateOne(
            { _id: pending._id, status: 'pending' },
            { $set: { status: 'rejected', reason: 'limit_reached_at_settlement' } },
        );
        return { settled: false, reason: 'limit_reached' };
    }

    // Claim the row before paying. `status: 'pending'` in the filter makes this
    // a compare-and-swap: two concurrent deliveries race here and exactly one
    // wins, so the reward cannot be paid twice.
    const claimed = await FoodReferralLog.findOneAndUpdate(
        { _id: pending._id, status: 'pending' },
        {
            $set: {
                status: 'credited',
                settledAt: new Date(),
                qualifyingOrderId: orderId || null,
            },
        },
        { new: true },
    ).lean();

    if (!claimed) return { settled: false, reason: 'already_settled' };

    try {
        const reward = Math.max(0, Number(claimed.rewardAmount) || 0);
        const referredReward = Math.max(0, Number(claimed.referredRewardAmount) || 0);

        const credits = [];
        if (reward > 0) {
            credits.push(
                creditReferralReward(claimed.referrerId, reward, {
                    role: 'USER',
                    refereeId: String(claimed.refereeId),
                    referralLogId: String(claimed._id),
                }),
            );
        }
        if (referredReward > 0) {
            credits.push(
                creditReferralReward(claimed.refereeId, referredReward, {
                    role: 'USER',
                    refereeId: String(claimed.refereeId),
                    referralLogId: String(claimed._id),
                }),
            );
        }
        await Promise.all(credits);

        // `referralCount` now means successful referrals, which is what the
        // limit and the user-facing count should both reflect.
        await FoodUser.updateOne({ _id: claimed.referrerId }, { $inc: { referralCount: 1 } });

        logger.info(
            `Referral settled: referrer=${claimed.referrerId} referee=${claimed.refereeId} ` +
            `reward=${reward} referredReward=${referredReward} order=${orderId}`,
        );
        return { settled: true, reward };
    } catch (err) {
        // Put the row back so a later delivered order retries. The CAS above
        // still guarantees at most one payout, and leaving it marked credited
        // would silently owe someone money.
        await FoodReferralLog.updateOne(
            { _id: claimed._id },
            { $set: { status: 'pending', settledAt: null, qualifyingOrderId: null } },
        );
        logger.error(
            `Referral settlement failed, returned to pending: log=${claimed._id}: ${err?.stack || err}`,
        );
        return { settled: false, reason: 'credit_failed' };
    }
};

/**
 * Fire-and-forget wrapper for order completion paths.
 *
 * A referral must never be able to fail a delivery, so this swallows errors
 * after logging them. The row stays pending and the next completed order by
 * the same user retries it.
 */
export const settleUserReferralSafely = async (userId, orderId) => {
    try {
        return await settleUserReferralOnDelivery(userId, orderId);
    } catch (err) {
        logger.warn(`Referral settlement error for user ${userId}: ${err?.message || err}`);
        return { settled: false, reason: 'error' };
    }
};
