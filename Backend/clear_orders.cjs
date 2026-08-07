const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dooriqofficial_db_user:aTQ0jC2tnzY5iZL0@cluster0.gshk9cc.mongodb.net/dooriq';

async function clearOrdersAndTransactions() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.\n');

    const db = mongoose.connection.db;

    const collections = [
      'food_orders',
      'orders',
      'food_transactions',
      'transactions',
      'food_delivery_order_emergency_requests',
      'food_offer_usages',
      'payments',
      'refunds',
      'settlements',
      'food_delivery_bonus_transactions'
    ];

    console.log('=== BEFORE DELETION ===');
    for (const name of collections) {
      try {
        const count = await db.collection(name).countDocuments();
        console.log(`  ${name}: ${count} documents`);
      } catch (e) {
        console.log(`  ${name}: collection not found`);
      }
    }

    console.log('\n--- DELETING ORDERS & TRANSACTIONS ---');
    for (const name of collections) {
      try {
        const res = await db.collection(name).deleteMany({});
        console.log(`  Cleared '${name}': deleted ${res.deletedCount} documents.`);
      } catch (e) {
        console.log(`  Skipped '${name}': ${e.message}`);
      }
    }

    console.log('\n=== AFTER DELETION VERIFICATION ===');
    for (const name of collections) {
      try {
        const count = await db.collection(name).countDocuments();
        console.log(`  ${name}: ${count} documents remaining`);
      } catch (e) {
        console.log(`  ${name}: collection not found`);
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ All orders and transactions have been successfully cleared from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing orders:', error.message);
    process.exit(1);
  }
}

clearOrdersAndTransactions();
