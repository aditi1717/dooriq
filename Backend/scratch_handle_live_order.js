import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { FoodDeliveryPartner } from './src/modules/food/delivery/models/deliveryPartner.model.js';
import { FoodOrder } from './src/modules/food/orders/models/order.model.js';

const TARGET_PHONE = '6264560457';

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.\n');

        // 1. Find delivery partner with this phone number (checking exact, regex, or last 10 digits)
        const partners = await FoodDeliveryPartner.find({
            phone: { $regex: TARGET_PHONE }
        });
        console.log(`Found ${partners.length} delivery partner(s) matching phone ${TARGET_PHONE}:`);
        partners.forEach(p => console.log(` - ID: ${p._id}, Name: ${p.name}, Phone: ${p.phone}, Status: ${p.status}`));

        const partnerIds = partners.map(p => p._id);

        // 2. Find live orders assigned to these delivery partners or matching this phone in orders
        const terminalStatuses = ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

        const liveOrdersAssigned = await FoodOrder.find({
            'dispatch.deliveryPartnerId': { $in: partnerIds },
            orderStatus: { $nin: terminalStatuses }
        });

        console.log(`\nFound ${liveOrdersAssigned.length} live order(s) assigned to delivery partner(s):`);
        for (const order of liveOrdersAssigned) {
            console.log(` - Order ID: ${order.order_id || order._id}, Status: ${order.orderStatus}, Dispatch Status: ${order.dispatch?.status}`);
        }

        // 3. Check if there are any other live orders with customer phone or deliveryAddress phone matching target phone
        const liveOrdersCustomer = await FoodOrder.find({
            $or: [
                { customerPhone: { $regex: TARGET_PHONE } },
                { 'deliveryAddress.phone': { $regex: TARGET_PHONE } }
            ],
            orderStatus: { $nin: terminalStatuses }
        });
        console.log(`\nFound ${liveOrdersCustomer.length} live order(s) placed by customer phone ${TARGET_PHONE}:`);
        for (const order of liveOrdersCustomer) {
            console.log(` - Order ID: ${order.order_id || order._id}, Status: ${order.orderStatus}, Assigned Rider: ${order.dispatch?.deliveryPartnerId}`);
        }

        // Combine all live orders found
        const allLiveOrders = [...liveOrdersAssigned];
        for (const o of liveOrdersCustomer) {
            if (!allLiveOrders.some(x => String(x._id) === String(o._id))) {
                allLiveOrders.push(o);
            }
        }

        if (allLiveOrders.length === 0) {
            console.log('\n--> No live orders found for phone 6264560457.');
        } else {
            console.log(`\nUpdating / Cancelling ${allLiveOrders.length} live order(s)...`);
            for (const order of allLiveOrders) {
                // Cancel live order or unassign delivery boy
                order.orderStatus = 'cancelled_by_admin';
                order.dispatch.status = 'cancelled';
                order.statusHistory.push({
                    at: new Date(),
                    byRole: 'ADMIN',
                    from: order.orderStatus,
                    to: 'cancelled_by_admin',
                    note: 'Cancelled live order requested by user for delivery partner 6264560457'
                });
                await order.save();
                console.log(`✓ Updated Order ${order.order_id || order._id} to 'cancelled_by_admin'`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error executing script:', err);
        process.exit(1);
    }
}

run();
