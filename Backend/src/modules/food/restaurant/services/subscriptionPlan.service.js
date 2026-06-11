import mongoose from "mongoose";
import { FoodRestaurant } from "../models/restaurant.model.js";
import { FoodTransaction } from "../../orders/models/foodTransaction.model.js";
import { FoodRestaurantWithdrawal } from "../models/foodRestaurantWithdrawal.model.js";
import { getRestaurantSubscriptionSettings } from "../../admin/services/admin.service.js";
import { logRestaurantSubscriptionHistory } from "./subscriptionHistory.service.js";

const GST_RATE = 0.18;

export const SUBSCRIPTION_PLAN_KEYS = {
    STARTER: "starter",
    GROWTH: "growth",
    PREMIUM: "premium",
};

const LEGACY_PLAN_MAP = {
    silver: SUBSCRIPTION_PLAN_KEYS.STARTER,
    gold: SUBSCRIPTION_PLAN_KEYS.GROWTH,
    pro: SUBSCRIPTION_PLAN_KEYS.GROWTH,
    elite: SUBSCRIPTION_PLAN_KEYS.PREMIUM,
};

const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizePlanName = (value) => {
    const plan = String(value || "").trim().toLowerCase();
    if (plan === SUBSCRIPTION_PLAN_KEYS.STARTER || plan === SUBSCRIPTION_PLAN_KEYS.GROWTH || plan === SUBSCRIPTION_PLAN_KEYS.PREMIUM) {
        return plan;
    }
    return LEGACY_PLAN_MAP[plan] || SUBSCRIPTION_PLAN_KEYS.STARTER;
};

export const buildPlanCatalog = (settings = {}) => {
    const starterPrice = Math.max(0, toNum(settings.starterPrice, 999));
    const growthPrice = Math.max(0, toNum(settings.growthPrice, 1999));
    const premiumPrice = Math.max(0, toNum(settings.premiumPrice, 2999));
    const starterMinGmv = Math.max(0, toNum(settings.starterMinGmv, 0));
    const starterMaxGmv = Math.max(starterMinGmv, toNum(settings.starterMaxGmv, 30000));
    const growthMinGmv = Math.max(starterMaxGmv, toNum(settings.growthMinGmv, starterMaxGmv + 0.01));
    const growthMaxGmv = Math.max(growthMinGmv, toNum(settings.growthMaxGmv, 60000));
    const premiumMinGmv = Math.max(growthMaxGmv, toNum(settings.premiumMinGmv, growthMaxGmv + 0.01));

    return {
        starterMinGmv,
        starterMaxGmv,
        growthMinGmv,
        growthMaxGmv,
        premiumMinGmv,
        plans: [
            { id: SUBSCRIPTION_PLAN_KEYS.STARTER, label: "Starter", basePrice: starterPrice, gmvMin: starterMinGmv, gmvMax: starterMaxGmv },
            { id: SUBSCRIPTION_PLAN_KEYS.GROWTH, label: "Growth", basePrice: growthPrice, gmvMin: growthMinGmv, gmvMax: growthMaxGmv },
            { id: SUBSCRIPTION_PLAN_KEYS.PREMIUM, label: "Premium", basePrice: premiumPrice, gmvMin: premiumMinGmv, gmvMax: null },
        ],
    };
};

export const resolveEligiblePlanByGmv = (gmv30d = 0, catalog = buildPlanCatalog({})) => {
    const safeGmv = Math.max(0, toNum(gmv30d, 0));
    if (safeGmv >= catalog.starterMinGmv && safeGmv <= catalog.starterMaxGmv) return SUBSCRIPTION_PLAN_KEYS.STARTER;
    if (safeGmv >= catalog.growthMinGmv && safeGmv <= catalog.growthMaxGmv) return SUBSCRIPTION_PLAN_KEYS.GROWTH;
    return SUBSCRIPTION_PLAN_KEYS.PREMIUM;
};

export const getRestaurantGmvLast30Days = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) return 0;
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);

    const agg = await FoodTransaction.aggregate([
        {
            $match: {
                restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
                status: { $in: ["authorized", "captured"] },
                createdAt: { $gte: start, $lte: now },
            },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amounts.restaurantShare", 0] } } } },
    ]);

    return Math.max(0, toNum(agg?.[0]?.total, 0));
};

export const resolveRestaurantPlanEligibility = async (restaurantId, settingsOverride = null) => {
    const settings = settingsOverride || (await getRestaurantSubscriptionSettings()) || {};
    const catalog = buildPlanCatalog(settings);
    const gmv30d = await getRestaurantGmvLast30Days(restaurantId);
    const eligiblePlan = resolveEligiblePlanByGmv(gmv30d, catalog);
    return {
        eligiblePlan,
        gmv30d,
        thresholdsUsed: {
            starterMinGmv: catalog.starterMinGmv,
            starterMaxGmv: catalog.starterMaxGmv,
            growthMinGmv: catalog.growthMinGmv,
            growthMaxGmv: catalog.growthMaxGmv,
            premiumMinGmv: catalog.premiumMinGmv,
        },
        planCatalog: catalog.plans,
    };
};

export const resolvePlanPricingFromEligibility = async (restaurantId, settingsOverride = null) => {
    const eligibility = await resolveRestaurantPlanEligibility(restaurantId, settingsOverride);
    const selected = eligibility.planCatalog.find((plan) => plan.id === eligibility.eligiblePlan) || eligibility.planCatalog[0];
    return {
        planName: selected?.id || SUBSCRIPTION_PLAN_KEYS.STARTER,
        baseAmount: Math.max(0, toNum(selected?.basePrice, 0)),
        eligibility,
    };
};

export const buildSubscriptionTotals = (planBase, paymentType = "later", partialBase = 0) => {
    const normalizedType = ["full", "partial", "later"].includes(String(paymentType)) ? String(paymentType) : "later";
    const base = Math.max(0, toNum(planBase, 0));
    const planGST = Math.round(base * GST_RATE);
    const planTotal = base + planGST;

    let paidBase = 0;
    if (normalizedType === "full") paidBase = base;
    if (normalizedType === "partial") paidBase = Math.max(0, Math.min(base, toNum(partialBase, 0)));

    const paidGST = Math.round(paidBase * GST_RATE);
    const paidTotal = paidBase + paidGST;
    const dueTotal = Math.max(0, planTotal - paidTotal);

    return {
        paymentType: normalizedType,
        planGST,
        planTotal,
        paidBase,
        paidGST,
        paidTotal,
        dueTotal,
    };
};

export const computeRestaurantAvailableEarnings = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) return 0;
    const rid = new mongoose.Types.ObjectId(String(restaurantId));

    const [earningsAgg, pendingWithdrawalsAgg, restaurant] = await Promise.all([
        FoodTransaction.aggregate([
            {
                $match: {
                    restaurantId: rid,
                    status: { $in: ["captured", "authorized"] },
                    "settlement.isRestaurantSettled": { $ne: true },
                },
            },
            { $group: { _id: null, total: { $sum: { $ifNull: ["$amounts.restaurantShare", 0] } } } },
        ]),
        FoodRestaurantWithdrawal.aggregate([
            {
                $match: {
                    restaurantId: rid,
                    $expr: { $eq: [{ $toLower: { $trim: { input: "$status" } } }, "pending"] },
                },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        FoodRestaurant.findById(rid).select("subscriptionAutoDeductedAmount").lean(),
    ]);

    const earnings = Math.max(0, toNum(earningsAgg?.[0]?.total, 0));
    const pendingWithdrawals = Math.max(0, toNum(pendingWithdrawalsAgg?.[0]?.total, 0));
    const subscriptionReserved = Math.max(0, toNum(restaurant?.subscriptionAutoDeductedAmount, 0));
    return Math.max(0, earnings - pendingWithdrawals - subscriptionReserved);
};

export const attemptAutoSettleSubscriptionDue = async (restaurantId) => {
    if (!restaurantId) return { settled: false, reason: "missing_restaurant_id" };
    const restaurant = await FoodRestaurant.findById(restaurantId);
    if (!restaurant) return { settled: false, reason: "restaurant_not_found" };

    const dueAmount = Math.max(0, toNum(restaurant.subscriptionDueAmount, 0));
    if (dueAmount <= 0) return { settled: false, reason: "no_due" };
    const dueBefore = dueAmount;
    const paidBefore = toNum(restaurant.subscriptionPaidAmount, 0);

    const availableEarnings = await computeRestaurantAvailableEarnings(restaurantId);
    if (availableEarnings < dueAmount) {
        return { settled: false, reason: "insufficient_earnings", availableEarnings, dueAmount };
    }

    restaurant.subscriptionPaidAmount = toNum(restaurant.subscriptionPaidAmount, 0) + dueAmount;
    restaurant.subscriptionAutoDeductedAmount = toNum(restaurant.subscriptionAutoDeductedAmount, 0) + dueAmount;
    restaurant.subscriptionDueAmount = 0;
    restaurant.subscriptionStatus = "paid";
    await restaurant.save();
    const gmvLast30Days = await getRestaurantGmvLast30Days(restaurantId);
    await logRestaurantSubscriptionHistory({
        restaurantId,
        eventType: "subscription_auto_deduct",
        plan: restaurant.subscriptionPlan,
        amount: dueAmount,
        dueBefore,
        dueAfter: 0,
        paidBefore,
        paidAfter: toNum(restaurant.subscriptionPaidAmount, 0),
        gmvLast30Days,
        note: "Auto-settled subscription due from available earnings",
    }).catch(() => null);

    return {
        settled: true,
        dueSettled: dueAmount,
        availableEarningsBeforeSettle: availableEarnings,
        remainingAvailableAfterSettle: Math.max(0, availableEarnings - dueAmount),
    };
};

export const isSubscriptionExpired = (restaurant) => {
    if (!restaurant?.subscriptionValidTill) return false;
    const validTill = new Date(restaurant.subscriptionValidTill);
    if (Number.isNaN(validTill.getTime())) return false;
    return validTill.getTime() < Date.now();
};
