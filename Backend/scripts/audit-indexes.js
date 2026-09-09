// Read-only index audit for the hot paths.
//
// Explains each query shape the app actually runs under load and reports the
// winning plan. Anything that reports COLLSCAN, or examines far more documents
// than it returns, is a query that will fall over as the collection grows —
// those are the ones worth an index.
//
// Writes nothing. Safe to run against production.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const OID = () => new mongoose.Types.ObjectId();

/**
 * Query shapes taken from the services that run on every order, every rider
 * heartbeat and every app open. Values are dummies — the planner picks an
 * index from the shape, not the values.
 */
const SHAPES = [
    // --- dispatch: runs for every order, over every online rider ----------
    {
        label: 'dispatch: online riders in a zone',
        coll: 'food_delivery_partners',
        filter: { availabilityStatus: 'online', activeZoneId: OID() },
    },
    {
        label: 'dispatch: online riders near a point (2dsphere)',
        coll: 'food_delivery_partners',
        filter: {
            availabilityStatus: 'online',
            lastLocation: {
                $near: { $geometry: { type: 'Point', coordinates: [75.78, 26.91] }, $maxDistance: 8000 },
            },
        },
    },
    {
        label: 'dispatch: freshest online riders',
        coll: 'food_delivery_partners',
        filter: { availabilityStatus: 'online' },
        sort: { lastLocationAt: -1 },
    },

    // --- customer app: order list + active order polling ------------------
    {
        label: 'user: my orders, newest first',
        coll: 'food_orders',
        filter: { userId: OID() },
        sort: { createdAt: -1 },
    },
    {
        label: 'user: my active order',
        coll: 'food_orders',
        filter: { userId: OID(), orderStatus: { $in: ['PENDING', 'ACCEPTED', 'PREPARING', 'PICKED_UP'] } },
        sort: { createdAt: -1 },
    },

    // --- restaurant dashboard --------------------------------------------
    {
        label: 'restaurant: incoming orders',
        coll: 'food_orders',
        filter: { restaurantId: OID(), orderStatus: { $in: ['PENDING', 'ACCEPTED'] } },
        sort: { createdAt: -1 },
    },

    // --- rider app --------------------------------------------------------
    {
        label: 'rider: my assigned orders',
        coll: 'food_orders',
        filter: { 'dispatch.deliveryPartnerId': OID(), orderStatus: { $nin: ['DELIVERED', 'CANCELLED'] } },
        sort: { updatedAt: -1 },
    },
    {
        label: 'dispatch sweep: offers awaiting a rider',
        coll: 'food_orders',
        filter: { 'dispatch.status': 'SEARCHING', orderStatus: 'ACCEPTED' },
        sort: { updatedAt: -1 },
    },
    {
        label: 'expiry sweep: orders past their acceptance deadline',
        coll: 'food_orders',
        filter: { orderStatus: 'PENDING', acceptanceDeadlineAt: { $lte: new Date() } },
    },

    // --- admin order management (the slowest screen) ----------------------
    {
        label: 'admin: orders by status, newest first',
        coll: 'food_orders',
        filter: { orderStatus: 'PENDING' },
        sort: { createdAt: -1 },
    },

    // --- customer home: restaurant listing --------------------------------
    {
        label: 'listing: active restaurants in a zone',
        coll: 'food_restaurants',
        filter: { zoneId: OID(), status: 'APPROVED' },
    },
    {
        label: 'listing: restaurants near a point (2dsphere)',
        coll: 'food_restaurants',
        filter: {
            status: 'APPROVED',
            location: {
                $near: { $geometry: { type: 'Point', coordinates: [75.78, 26.91] }, $maxDistance: 10000 },
            },
        },
    },

    // --- referrals --------------------------------------------------------
    {
        label: 'referral: pending log for a user',
        coll: 'food_referral_logs',
        filter: { refereeId: OID(), status: 'pending' },
    },
];

const summarise = (stage) => {
    // Walk to the leaf of the winning plan and name the access method.
    let s = stage;
    const path = [];
    while (s) {
        path.push(s.stage + (s.indexName ? `(${s.indexName})` : ''));
        s = s.inputStage || s.inputStages?.[0];
    }
    return path.join(' <- ');
};

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    try {
        const problems = [];

        for (const shape of SHAPES) {
            let out;
            try {
                let cursor = db.collection(shape.coll).find(shape.filter);
                if (shape.sort) cursor = cursor.sort(shape.sort);
                out = await cursor.limit(20).explain('executionStats');
            } catch (err) {
                console.log(`\n${shape.label}\n  [${shape.coll}] ERROR: ${err.message}`);
                continue;
            }

            const stats = out.executionStats || {};
            const winning = out.queryPlanner?.winningPlan?.queryPlan || out.queryPlanner?.winningPlan;
            const plan = summarise(winning);
            const examined = stats.totalDocsExamined ?? -1;
            const returned = stats.nReturned ?? -1;
            const millis = stats.executionTimeMillis ?? -1;

            const collscan = plan.includes('COLLSCAN');
            const inMemorySort = plan.includes('SORT(');
            const wasteful = returned > 0 && examined > returned * 20;

            const flag = collscan ? 'COLLSCAN' : inMemorySort ? 'IN-MEM SORT' : wasteful ? 'WASTEFUL' : 'ok';
            if (flag !== 'ok') problems.push(`${flag.padEnd(12)} ${shape.label}`);

            console.log(`\n${shape.label}`);
            console.log(`  coll      ${shape.coll}`);
            console.log(`  plan      ${plan}`);
            console.log(`  examined  ${examined} -> returned ${returned}  (${millis}ms)`);
            console.log(`  verdict   ${flag}`);
        }

        console.log('\n\n=== existing indexes on the collections above ===');
        for (const coll of [...new Set(SHAPES.map((s) => s.coll))]) {
            try {
                const idx = await db.collection(coll).indexes();
                console.log(`\n${coll}  (${await db.collection(coll).estimatedDocumentCount()} docs)`);
                for (const i of idx) console.log(`  ${i.name.padEnd(46)} ${JSON.stringify(i.key)}`);
            } catch (err) {
                console.log(`\n${coll}  ERROR: ${err.message}`);
            }
        }

        console.log('\n\n=== summary ===');
        if (!problems.length) console.log('No COLLSCANs, in-memory sorts or wasteful scans in the audited shapes.');
        else problems.forEach((p) => console.log('  ' + p));
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
