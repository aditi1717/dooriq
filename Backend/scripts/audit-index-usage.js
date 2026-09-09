// Read-only index usage report.
//
// $indexStats gives the number of times the query planner actually chose each
// index since the last mongod restart. Two things worth acting on come out of
// it: indexes with zero accesses (write cost for no read benefit) and
// collections whose only used index is _id (queries are scanning).
//
// Writes nothing. Safe on production.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const COLLECTIONS = [
    'food_orders',
    'food_delivery_partners',
    'food_restaurants',
    'food_users',
    'food_referral_logs',
    'food_notifications',
    'food_wallet_transactions',
    'food_page_contents',
];

const fmtBytes = (n) => {
    if (!Number.isFinite(n)) return '?';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${n.toFixed(1)}${u[i]}`;
};

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    try {
        const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
        const unused = [];

        for (const coll of COLLECTIONS) {
            if (!existing.has(coll)) {
                console.log(`\n${coll}\n  (collection does not exist)`);
                continue;
            }

            let stats = {};
            try {
                stats = await db.command({ collStats: coll });
            } catch {
                // collStats is unavailable on some managed tiers; keep going.
            }

            const rows = await db.collection(coll).aggregate([{ $indexStats: {} }]).toArray();
            rows.sort((a, b) => (b.accesses?.ops ?? 0) - (a.accesses?.ops ?? 0));

            const docs = stats.count ?? (await db.collection(coll).estimatedDocumentCount());
            console.log(
                `\n${coll}  —  ${docs} docs, data ${fmtBytes(stats.size)}, ` +
                    `indexes ${fmtBytes(stats.totalIndexSize)} across ${rows.length}`,
            );

            for (const r of rows) {
                const ops = r.accesses?.ops ?? 0;
                const flag = ops === 0 && r.name !== '_id_' ? '  <-- never used' : '';
                console.log(`  ${String(ops).padStart(9)}  ${r.name}${flag}`);
                if (ops === 0 && r.name !== '_id_') unused.push(`${coll}.${r.name}`);
            }

            // An index total far larger than the data itself means the write
            // path is paying more to maintain indexes than to store rows.
            if (stats.size && stats.totalIndexSize && stats.totalIndexSize > stats.size * 3) {
                console.log(
                    `  NOTE: index size is ${(stats.totalIndexSize / stats.size).toFixed(1)}x the data size`,
                );
            }
        }

        console.log('\n\n=== never-used indexes (candidates for removal) ===');
        if (!unused.length) {
            console.log('None — every index has been chosen by the planner at least once.');
        } else {
            unused.forEach((u) => console.log('  ' + u));
            console.log(
                '\nCounts reset when mongod restarts, so confirm over a full traffic\n' +
                    'cycle before dropping anything. An index backing a rare admin report\n' +
                    'or a unique constraint can legitimately show zero.',
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
