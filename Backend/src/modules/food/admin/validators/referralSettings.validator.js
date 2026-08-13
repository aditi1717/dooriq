import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const schema = z.object({
    referralRewardUser: z.number().min(0).optional(),
    referredRewardUser: z.number().min(0).optional(),
    referralRewardDelivery: z.number().min(0).optional(),
    referredRewardDelivery: z.number().min(0).optional(),
    referralLimitUser: z.number().min(0).optional(),
    referralLimitDelivery: z.number().min(0).optional(),
    userAppStoreUrl: z.string().optional(),
    userPlayStoreUrl: z.string().optional(),
    deliveryAppStoreUrl: z.string().optional(),
    deliveryPlayStoreUrl: z.string().optional(),
    isActive: z.boolean().optional()
});

export const validateReferralSettingsUpsertDto = (body) => {
    const normalized = {
        referralRewardUser: body?.referralRewardUser !== undefined ? Number(body.referralRewardUser) : undefined,
        referredRewardUser: body?.referredRewardUser !== undefined ? Number(body.referredRewardUser) : undefined,
        referralRewardDelivery: body?.referralRewardDelivery !== undefined ? Number(body.referralRewardDelivery) : undefined,
        referredRewardDelivery: body?.referredRewardDelivery !== undefined ? Number(body.referredRewardDelivery) : undefined,
        referralLimitUser: body?.referralLimitUser !== undefined ? Number(body.referralLimitUser) : undefined,
        referralLimitDelivery: body?.referralLimitDelivery !== undefined ? Number(body.referralLimitDelivery) : undefined,
        userAppStoreUrl: body?.userAppStoreUrl !== undefined ? String(body.userAppStoreUrl).trim() : undefined,
        userPlayStoreUrl: body?.userPlayStoreUrl !== undefined ? String(body.userPlayStoreUrl).trim() : undefined,
        deliveryAppStoreUrl: body?.deliveryAppStoreUrl !== undefined ? String(body.deliveryAppStoreUrl).trim() : undefined,
        deliveryPlayStoreUrl: body?.deliveryPlayStoreUrl !== undefined ? String(body.deliveryPlayStoreUrl).trim() : undefined,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined
    };

    const result = schema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

