import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;

    const ordersCol = db.collection('food_orders');
    const deleteOrdersResult = await ordersCol.deleteMany({});
    console.log(`Deleted ${deleteOrdersResult.deletedCount} orders from 'food_orders'.`);

    const usagesCol = db.collection('food_offer_usages');
    const deleteUsagesResult = await usagesCol.deleteMany({});
    console.log(`Deleted ${deleteUsagesResult.deletedCount} usages from 'food_offer_usages'.`);

    const offersCol = db.collection('food_offers');
    const resetOffersResult = await offersCol.updateMany({}, { $set: { usedCount: 0 } });
    console.log(`Reset usedCount to 0 for ${resetOffersResult.modifiedCount} offers in 'food_offers'.`);

    process.exit(0);
  } catch (err) {
    console.error('Error clearing orders:', err);
    process.exit(1);
  }
}

run();
