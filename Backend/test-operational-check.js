import mongoose from 'mongoose';
import { checkRestaurantOpenStatus } from './src/modules/food/orders/services/order.helpers.js';

const MONGODB_URI = 'mongodb+srv://dooriqofficial_db_user:aTQ0jC2tnzY5iZL0@cluster0.gshk9cc.mongodb.net/dooriq';

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    mongoose.set('strictQuery', false);

    const restaurantId = '6a18089f4dd53c5cb1c64da4'; // amannnnnnnn
    console.log(`Testing checkRestaurantOpenStatus for restaurant: ${restaurantId}`);

    // Test case 1: Open time (say, 12:00 PM on a Monday)
    const testDateOpen = new Date();
    // Set to next Monday, 12:00 PM local time
    testDateOpen.setDate(testDateOpen.getDate() + ((1 + 7 - testDateOpen.getDay()) % 7 || 7));
    testDateOpen.setHours(12, 0, 0, 0);
    const statusOpen = await checkRestaurantOpenStatus(restaurantId, testDateOpen);
    console.log(`Monday 12:00 PM: isOpen = ${statusOpen.isOpen}, reason = ${statusOpen.reason || 'None'}`);

    // Test case 2: Closed time (say, 3:00 AM on a Monday)
    const testDateClosed = new Date(testDateOpen);
    testDateClosed.setHours(3, 0, 0, 0);
    const statusClosed = await checkRestaurantOpenStatus(restaurantId, testDateClosed);
    console.log(`Monday 03:00 AM: isOpen = ${statusClosed.isOpen}, reason = ${statusClosed.reason || 'None'}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
