import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../src/modules/food/orders/models/foodTransaction.model.js';
import {
  attemptAutoSettleSubscriptionDue,
  computeRestaurantAvailableEarnings,
  resolveRestaurantPlanEligibility,
  getRestaurantGmvLast30Days,
} from '../src/modules/food/restaurant/services/subscriptionPlan.service.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseArgs = () => {
  const raw = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < raw.length; i += 1) {
    const key = raw[i];
    const val = raw[i + 1];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = val;
  }
  return args;
};

const main = async () => {
  const args = parseArgs();
  const restaurantId = String(args.restaurantId || '').trim();
  const targetGmv = toNum(args.targetGmv, 65000);

  if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
    throw new Error('Invalid --restaurantId. Pass a valid Mongo ObjectId.');
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

  await mongoose.connect(mongoUri);

  try {
    const restaurant = await FoodRestaurant.findById(restaurantId)
      .select('restaurantName subscriptionDueAmount subscriptionStatus subscriptionPaidAmount subscriptionValidTill');

    if (!restaurant) {
      throw new Error(`Restaurant not found for id ${restaurantId}`);
    }

    const beforeGmv = await getRestaurantGmvLast30Days(restaurantId);
    const beforeAvailable = await computeRestaurantAvailableEarnings(restaurantId);
    const beforeDue = toNum(restaurant.subscriptionDueAmount, 0);

    const delta = Math.max(0, targetGmv - beforeGmv);

    console.log('--- BEFORE ---');
    console.log({
      restaurantId,
      restaurantName: restaurant.restaurantName,
      gmvLast30Days: Number(beforeGmv.toFixed(2)),
      availableEarnings: Number(beforeAvailable.toFixed(2)),
      subscriptionDueAmount: beforeDue,
      subscriptionStatus: restaurant.subscriptionStatus,
      subscriptionPaidAmount: toNum(restaurant.subscriptionPaidAmount, 0),
      subscriptionValidTill: restaurant.subscriptionValidTill,
      targetGmv,
      deltaToAdd: Number(delta.toFixed(2)),
    });

    if (delta > 0) {
      const now = new Date();
      const syntheticTx = {
        orderId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        paymentMethod: 'cash',
        status: 'captured',
        pricing: {
          subtotal: delta,
          tax: 0,
          packagingFee: 0,
          deliveryFee: 0,
          platformFee: 0,
          restaurantCommission: 0,
          discount: 0,
          total: delta,
          currency: 'INR',
        },
        payment: {
          method: 'cash',
          status: 'captured',
          amountDue: 0,
        },
        amounts: {
          totalCustomerPaid: delta,
          restaurantShare: delta,
          restaurantCommission: 0,
          riderShare: 0,
          platformNetProfit: 0,
          taxAmount: 0,
        },
        gateway: {
          provider: 'test-script',
        },
        settlement: {
          isRestaurantSettled: false,
          isRiderSettled: false,
        },
        history: [
          {
            kind: 'captured',
            amount: delta,
            at: now,
            note: 'Synthetic transaction for GMV/auto-settle test',
            recordedBy: { role: 'admin' },
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const created = await FoodTransaction.create(syntheticTx);
      console.log('Inserted synthetic food_transaction:', String(created._id));
    } else {
      console.log('No GMV addition needed. Current GMV already >= target.');
    }

    const settleResult = await attemptAutoSettleSubscriptionDue(restaurantId);

    const updatedRestaurant = await FoodRestaurant.findById(restaurantId)
      .select('subscriptionDueAmount subscriptionStatus subscriptionPaidAmount subscriptionValidTill');
    const afterGmv = await getRestaurantGmvLast30Days(restaurantId);
    const afterAvailable = await computeRestaurantAvailableEarnings(restaurantId);
    const eligibility = await resolveRestaurantPlanEligibility(restaurantId);

    console.log('--- AFTER ---');
    console.log({
      gmvLast30Days: Number(afterGmv.toFixed(2)),
      availableEarnings: Number(afterAvailable.toFixed(2)),
      subscriptionDueAmount: toNum(updatedRestaurant?.subscriptionDueAmount, 0),
      subscriptionStatus: updatedRestaurant?.subscriptionStatus,
      subscriptionPaidAmount: toNum(updatedRestaurant?.subscriptionPaidAmount, 0),
      autoSettleResult: settleResult,
      eligiblePlan: eligibility.eligiblePlan,
      thresholdsUsed: eligibility.thresholdsUsed,
    });
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exitCode = 1;
});
