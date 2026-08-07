import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { haversineKm } from './src/modules/food/orders/services/order.helpers.js';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;

    // 1. Get delivery partner by phone "6264560457"
    const partner = await db.collection('food_delivery_partners').findOne({ phone: "6264560457" });
    if (!partner) {
      console.log("Delivery partner 6264560457 not found!");
      process.exit(1);
    }
    console.log("Partner details:", {
      id: partner._id,
      name: partner.name,
      phone: partner.phone,
      lastLat: partner.lastLat,
      lastLng: partner.lastLng,
      lastLocationAt: partner.lastLocationAt
    });

    // 2. Get order details for #FOD-5517689
    const order = await db.collection('food_orders').findOne({ $or: [{ orderId: "FOD-5517689" }, { orderId: 5517689 }] });
    if (order) {
      console.log("Full Order document in MongoDB:");
      console.log(JSON.stringify(order, null, 2));
    } else {
      console.log("Order not found!");
    }

    // 2. Get restaurant "Dooriq Royal Kitchen"
    const restaurant = await db.collection('food_restaurants').findOne({ restaurantName: /Dooriq Royal Kitchen/i });
    if (!restaurant) {
      console.log("Restaurant Dooriq Royal Kitchen not found!");
      process.exit(1);
    }
    console.log("Restaurant details:", {
      id: restaurant._id,
      name: restaurant.restaurantName,
      location: restaurant.location
    });

    // 3. Compute distance
    if (restaurant.location?.coordinates && partner.lastLat != null && partner.lastLng != null) {
      const [rLng, rLat] = restaurant.location.coordinates;
      const dist = haversineKm(rLat, rLng, partner.lastLat, partner.lastLng);
      console.log(`Calculated Haversine Distance: ${dist} km`);
    } else {
      console.log("Cannot compute distance: missing coordinates on partner or restaurant.");
    }

    process.exit(0);
  } catch (err) {
    console.error('Error running script:', err);
    process.exit(1);
  }
}

run();
