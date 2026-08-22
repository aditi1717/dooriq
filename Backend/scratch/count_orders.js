import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { FoodOrder } from '../src/modules/food/orders/models/order.model.js';

async function run() {
    try {
        console.log('Connecting to database:', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.\n');

        // Aggregate by orderStatus
        const stats = await FoodOrder.aggregate([
            {
                $group: {
                    _id: '$orderStatus',
                    count: { $sum: 1 }
                }
            }
        ]);
        console.log('--- Orders by orderStatus ---');
        stats.forEach(s => {
            console.log(`Status: ${s._id}, Count: ${s.count}`);
        });

        // Aggregate by payment.status
        const payStats = await FoodOrder.aggregate([
            {
                $group: {
                    _id: '$payment.status',
                    count: { $sum: 1 }
                }
            }
        ]);
        console.log('\n--- Orders by payment.status ---');
        payStats.forEach(s => {
            console.log(`Payment Status: ${s._id}, Count: ${s.count}`);
        });

        // Let's print some orders with status 'created' or 'confirmed'
        const sampleOrders = await FoodOrder.find({
            orderStatus: { $in: ['created', 'confirmed'] }
        }).limit(5).lean();
        console.log('\n--- Sample ' + sampleOrders.length + ' created/confirmed orders ---');
        sampleOrders.forEach(o => {
            console.log(`ID: ${o._id}, Status: ${o.orderStatus}, Payment Method: ${o.payment?.method}, Payment Status: ${o.payment?.status}, Dispatch Status: ${o.dispatch?.status}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
