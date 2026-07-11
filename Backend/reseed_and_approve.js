import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { FoodRestaurant } from './src/modules/food/restaurant/models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from './src/modules/food/restaurant/models/outletTimings.model.js';
import { approveRestaurant } from './src/modules/food/admin/services/admin.service.js';

const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const OLD_PHONE = '9876500006';
const NEW_PHONE = '9876500007';
const OWNER_EMAIL = 'aditiparihar179@gmail.com';

async function run() {
    try {
        console.log('Connecting...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.\n');

        // Delete old
        const old = await FoodRestaurant.findOne({
            $or: [{ ownerPhone: OLD_PHONE }, { ownerPhoneLast10: OLD_PHONE.slice(-10) }]
        });
        if (old) {
            await FoodRestaurantOutletTimings.deleteOne({ restaurantId: old._id });
            await FoodRestaurant.deleteOne({ _id: old._id });
            console.log(`✓ Deleted old restaurant: ${old.restaurantName} (${OLD_PHONE})`);
        }

        // Also delete any existing with new phone
        const existing = await FoodRestaurant.findOne({
            $or: [{ ownerPhone: NEW_PHONE }, { ownerPhoneLast10: NEW_PHONE.slice(-10) }]
        });
        if (existing) {
            await FoodRestaurantOutletTimings.deleteOne({ restaurantId: existing._id });
            await FoodRestaurant.deleteOne({ _id: existing._id });
            console.log(`✓ Cleaned up existing restaurant with phone ${NEW_PHONE}`);
        }

        // Create new
        console.log(`\nSeeding new restaurant (phone: ${NEW_PHONE}, email: ${OWNER_EMAIL})...`);
        const restaurant = await FoodRestaurant.create({
            restaurantName: 'The Royal Kitchen',
            restaurantNameNormalized: 'the royal kitchen',
            ownerName: 'Aditi Parihar',
            ownerEmail: OWNER_EMAIL,
            ownerPhone: NEW_PHONE,
            ownerPhoneDigits: NEW_PHONE,
            ownerPhoneLast10: NEW_PHONE.slice(-10),
            primaryContactNumber: NEW_PHONE,
            pureVegRestaurant: false,
            status: 'pending',
            location: {
                type: 'Point',
                coordinates: [75.8577, 22.7196],
                latitude: 22.7196,
                longitude: 75.8577,
                formattedAddress: 'Vijay Nagar, Indore, MP',
                address: 'Vijay Nagar, Indore',
                addressLine1: 'Vijay Nagar Square',
                city: 'Indore',
                state: 'MP',
                pincode: '452001'
            },
            cuisines: ['North Indian', 'Chinese', 'Fast Food'],
            openingTime: '10:00',
            closingTime: '23:00',
            openDays: DAY_NAMES,
            estimatedDeliveryTime: '30 mins',
            estimatedDeliveryTimeMinutes: 30,
            panNumber: 'ABCDE1234F',
            nameOnPan: 'Aditi Parihar',
            gstRegistered: false,
            fssaiNumber: '12345678901234',
            fssaiExpiry: new Date('2028-12-31'),
            accountNumber: '1234567890',
            ifscCode: 'SBIN0000001',
            accountHolderName: 'Aditi Parihar',
            accountType: 'Saving',
            profileImage: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
            panImage: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
            fssaiImage: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
            onboardingFeePaid: false,
            subscriptionPlan: 'starter',
            subscriptionStatus: 'due',
            subscriptionAmount: 999,
            subscriptionPaidAmount: 0,
            subscriptionDueAmount: 999,
            subscriptionValidTill: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        await FoodRestaurantOutletTimings.updateOne(
            { restaurantId: restaurant._id },
            { $setOnInsert: { restaurantId: restaurant._id, timings: DAY_NAMES.map(day => ({ day, isOpen: true, openingTime: '10:00', closingTime: '23:00' })) } },
            { upsert: true }
        );

        console.log(`✓ Created: "${restaurant.restaurantName}" (ID: ${restaurant._id})`);
        console.log(`  Status: ${restaurant.status}`);

        // Approve and send email
        console.log(`\nApproving and sending approval email to ${OWNER_EMAIL}...`);
        const approved = await approveRestaurant(String(restaurant._id));

        console.log(`\n✓ Restaurant approved!`);
        console.log(`  Name:   ${approved.restaurantName}`);
        console.log(`  Phone:  ${approved.ownerPhone}`);
        console.log(`  Email:  ${approved.ownerEmail}`);
        console.log(`  Status: ${approved.status}`);
        console.log(`\nCheck inbox at: ${OWNER_EMAIL}`);

        process.exit(0);
    } catch (err) {
        console.error('ERROR:', err);
        process.exit(1);
    }
}

run();
