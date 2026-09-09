// The Help & Support screen in each Flutter app renders whatever
// GET /food/pages/support?module=<MODULE> returns. Only the USER module was ever
// filled in, so the delivery and restaurant apps land straight in their empty
// state ("data": null). This seeds sensible starting content for the modules
// that have none.
//
// Safe to re-run: it only writes to a module whose support document is missing
// or empty, so it will never overwrite copy an admin has since edited. Pass
// --force to overwrite anyway, and --only=DELIVERY,RESTAURANT to narrow it.
//
// Icon strings must be ones the apps can map. The user app's _iconFor()
// understands: description, assignment, replay, shield, access_time,
// verified_user, groups — anything else falls back to a help circle, which is
// ugly but not broken.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodPageContent } from '../src/modules/food/admin/models/pageContent.model.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const CONTACT = {
    phone: '6375095971',
    email: 'support@dooriq.in',
    chatAvailability: 'Available 9AM - 9PM',
};

const item = (order, icon, title, description, content = '') => ({
    icon,
    title,
    description,
    content,
    color: '',
    bgColor: '',
    order,
    enabled: true,
});

const SUPPORT_INFO = [
    item(0, 'access_time', 'Support Hours', '9AM - 9PM · Everyday'),
    item(1, 'verified_user', 'Response Time', 'Within 24 hours'),
    item(2, 'groups', 'We Care', 'Your satisfaction is our priority'),
];

const CONTENT = {
    DELIVERY: {
        heroTitle: 'Need a hand on the road?',
        heroSubtitle: 'Payouts, orders, app trouble — our partner support team is here for you.',
        quickHelp: [
            item(
                0,
                'assignment',
                'Order & Pickup Issues',
                'Restaurant delay, wrong order or a customer you cannot reach',
                'If the restaurant is running late, mark the delay in the app so the customer is told automatically. If the customer does not answer after three calls, wait at the drop location and raise a "customer unreachable" request — do not leave the order unattended.',
            ),
            item(
                1,
                'replay',
                'Earnings & Payouts',
                'Trip earnings, incentives and weekly settlement',
                'Earnings for a delivery appear in your Pocket as soon as the order is marked delivered. Weekly payouts settle to your registered bank account. If a trip is missing from your statement, raise it within 7 days with the order ID.',
            ),
            item(
                2,
                'description',
                'Account & Documents',
                'KYC, vehicle papers and your delivery zone',
                'Your zone is chosen when you register and decides which orders reach you. To change it, or to update your licence, RC or bank details, contact support — documents are verified within 24 hours.',
            ),
            item(
                3,
                'shield',
                'Safety & Emergency',
                'Accidents, unsafe drops and harassment',
                'Your safety comes first. Use the SOS button in the app for an emergency. For an unsafe drop location or a customer behaving inappropriately, cancel the trip and report it — you will not be penalised for a genuine safety cancellation.',
            ),
        ],
        contact: CONTACT,
        supportInfo: [
            item(0, 'access_time', 'Support Hours', '9AM - 9PM · Everyday'),
            item(1, 'verified_user', 'Response Time', 'Within 24 hours'),
            item(2, 'shield', 'Emergency Help', 'SOS is available 24/7 in the app'),
        ],
        footerTitle: 'Thank you for riding with Dooriq!',
        footerSubtitle: 'Every order you deliver keeps the city fed.',
    },

    RESTAURANT: {
        heroTitle: 'We are here to help your kitchen run',
        heroSubtitle: 'Orders, payouts, menu and outlet settings — support is a tap away.',
        quickHelp: [
            item(
                0,
                'assignment',
                'Order Management',
                'Accepting, preparing and handing over orders',
                'Accept an order to start the prep timer and get a rider assigned. If you need longer, extend the prep time in the app rather than letting the order sit — the customer and the rider are both updated automatically.',
            ),
            item(
                1,
                'description',
                'Menu & Pricing',
                'Items, categories, availability and offers',
                'Add or edit items from Menu Management. New items and price changes go to admin for approval before they appear to customers; marking an item out of stock is instant and needs no approval.',
            ),
            item(
                2,
                'replay',
                'Payouts & Settlement',
                'Earnings, commission and refunds',
                'Order earnings appear in your wallet once the order is delivered, net of commission. Settlement runs on your agreed cycle. If a refund was issued to a customer for your order, the deduction shows against that order ID in your statement.',
            ),
            item(
                3,
                'shield',
                'Outlet & Complaints',
                'Timings, delivery radius and customer complaints',
                'Opening hours, location and delivery radius are managed under Outlet Info. If a customer raises a complaint against an order, respond within 48 hours — unanswered complaints are decided in the customer’s favour.',
            ),
        ],
        contact: CONTACT,
        supportInfo: SUPPORT_INFO,
        footerTitle: 'Thank you for partnering with Dooriq!',
        footerSubtitle: 'We grow when your kitchen does.',
    },

    // Fallback for any app that asks without a module, or for a module that has
    // no document of its own. Deliberately generic.
    ALL: {
        heroTitle: 'How can we help?',
        heroSubtitle: 'Our support team is available every day, 9AM to 9PM.',
        quickHelp: [
            item(0, 'description', 'FAQs', 'Answers to the questions we get most'),
            item(1, 'assignment', 'Order Issues', 'Help with an order or its tracking'),
            item(2, 'replay', 'Refunds & Payments', 'Questions about a payment or refund'),
            item(3, 'shield', 'Report a Problem', 'Tell us if something went wrong'),
        ],
        contact: CONTACT,
        supportInfo: SUPPORT_INFO,
        footerTitle: 'Thank you for choosing Dooriq!',
        footerSubtitle: 'We are always here to help you.',
    },
};

/** A document exists but has nothing the app could render. */
const isEmptySupport = (support) =>
    !support ||
    (!support.quickHelp?.length &&
        !support.supportInfo?.length &&
        !support.contact?.phone &&
        !support.contact?.email &&
        !support.heroTitle);

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    const force = process.argv.includes('--force');
    const onlyArg = process.argv.find((a) => a.startsWith('--only='));
    const only = onlyArg
        ? onlyArg
              .slice('--only='.length)
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
        : Object.keys(CONTENT);

    await mongoose.connect(mongoUri);

    try {
        for (const module of only) {
            const support = CONTENT[module];
            if (!support) {
                console.log(`${module.padEnd(11)} skipped — no content defined in this script`);
                continue;
            }

            const existing = await FoodPageContent.findOne({ key: 'support', module })
                .select('support')
                .lean();

            if (!force && !isEmptySupport(existing?.support)) {
                console.log(`${module.padEnd(11)} skipped — already has content (use --force to overwrite)`);
                continue;
            }

            await FoodPageContent.findOneAndUpdate(
                { key: 'support', module },
                { $set: { support }, $setOnInsert: { key: 'support', module, updatedByRole: 'SYSTEM' } },
                { upsert: true, new: true },
            );

            console.log(
                `${module.padEnd(11)} ${existing ? 'updated' : 'created'} — ` +
                    `${support.quickHelp.length} quick help, ${support.supportInfo.length} info`,
            );
        }
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
