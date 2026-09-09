// Drops the indexes that audit-redundant-indexes.js proved redundant.
//
// Each one below is a STRICT KEY PREFIX of the index named beside it, so the
// planner can already serve every query the dropped index served — that is a
// property of the index shapes, not of current traffic, which is why these are
// safe to drop where the usage-counter list was not.
//
// The matching declarations have been removed from the Mongoose schemas. Both
// halves are needed: autoIndex is on, so dropping in the database without
// changing the model just recreates the index on the next restart.
//
// Dry run by default. Pass --apply to actually drop.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const TARGETS = [
    {
        coll: 'food_orders',
        name: 'dispatch.status_1_orderStatus_1',
        coveredBy: 'dispatch.status_1_orderStatus_1_updatedAt_-1',
    },
    {
        coll: 'food_restaurants',
        name: 'restaurantName_1',
        coveredBy: 'restaurantName_1_ownerPhone_1',
    },
    {
        coll: 'food_referral_logs',
        name: 'referrerId_1',
        coveredBy: 'referrerId_1_role_1_createdAt_-1',
    },
    {
        coll: 'food_notifications',
        name: 'ownerType_1',
        coveredBy: 'ownerType_1_ownerId_1_createdAt_-1',
    },
    {
        // Not declared in any schema — a leftover from before rider zones moved
        // to activeZoneId. Nothing recreates it.
        coll: 'food_delivery_partners',
        name: 'zoneId_1',
        coveredBy: 'zoneId_1_availabilityStatus_1_status_1',
    },
];

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    const apply = process.argv.includes('--apply');
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    try {
        for (const t of TARGETS) {
            const indexes = await db.collection(t.coll).indexes();
            const target = indexes.find((i) => i.name === t.name);
            const covering = indexes.find((i) => i.name === t.coveredBy);

            if (!target) {
                console.log(`SKIP    ${t.coll}.${t.name} — already gone`);
                continue;
            }
            // Never drop an index whose claimed cover is missing: that would
            // leave the queries it served with nothing.
            if (!covering) {
                console.log(`REFUSE  ${t.coll}.${t.name} — covering index ${t.coveredBy} not found`);
                continue;
            }

            if (!apply) {
                console.log(`DRY RUN ${t.coll}.${t.name}  (covered by ${t.coveredBy})`);
                continue;
            }

            await db.collection(t.coll).dropIndex(t.name);
            console.log(`DROPPED ${t.coll}.${t.name}  (covered by ${t.coveredBy})`);
        }

        if (!apply) console.log('\nNothing changed. Re-run with --apply to drop.');
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
