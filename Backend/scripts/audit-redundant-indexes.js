// Finds indexes that are redundant by STRUCTURE, not by usage counters.
//
// audit-index-usage.js reports which indexes the planner has chosen. That is
// useful but not sufficient grounds for dropping anything: $indexStats
// counters reset when mongod restarts, and a zero can legitimately mean "backs
// a quarterly report" or "enforces a unique constraint".
//
// This script asks a stronger question. Index A is redundant when its key
// pattern is a strict prefix of index B's, because MongoDB can use a compound
// index for any prefix of its keys. { a: 1 } is redundant next to
// { a: 1, b: -1 }; { a: 1, b: 1 } is not redundant next to { b: 1, a: 1 },
// because key order matters. That is a property of the indexes themselves, so
// it holds regardless of traffic.
//
// Exclusions, all deliberate:
//   - _id_ is never droppable.
//   - unique / TTL / partial / collation indexes are never reported, even when
//     the prefix rule applies: they enforce or expire, and the covering index
//     does not inherit that.
//   - 2dsphere/text indexes are not prefix-comparable and are skipped.
//
// Read-only. Prints the drop commands rather than running them.
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
];

/** Special indexes carry semantics a covering index would not preserve. */
const isProtected = (idx) =>
    idx.name === '_id_' ||
    idx.unique === true ||
    idx.expireAfterSeconds !== undefined ||
    idx.partialFilterExpression !== undefined ||
    idx.collation !== undefined ||
    Object.values(idx.key).some((v) => typeof v !== 'number');

const keyEntries = (idx) => Object.entries(idx.key);

/** True when `a`'s keys are a strict prefix of `b`'s, same fields, same directions. */
const isStrictPrefixOf = (a, b) => {
    const ka = keyEntries(a);
    const kb = keyEntries(b);
    if (ka.length >= kb.length) return false;
    return ka.every(([field, dir], i) => kb[i][0] === field && kb[i][1] === dir);
};

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    try {
        const drops = [];
        const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

        for (const coll of COLLECTIONS) {
            if (!existing.has(coll)) continue;

            const indexes = await db.collection(coll).indexes();
            const comparable = indexes.filter((i) => !isProtected(i));
            const found = [];

            for (const candidate of comparable) {
                const covering = comparable.find((other) => isStrictPrefixOf(candidate, other));
                if (covering) {
                    found.push({ candidate, covering });
                    drops.push({ coll, name: candidate.name, by: covering.name });
                }
            }

            console.log(`\n${coll}  (${indexes.length} indexes, ${found.length} redundant)`);
            if (!found.length) {
                console.log('  nothing structurally redundant');
                continue;
            }
            for (const { candidate, covering } of found) {
                console.log(`  ${candidate.name}`);
                console.log(`      ${JSON.stringify(candidate.key)}`);
                console.log(`    covered by ${covering.name}`);
                console.log(`      ${JSON.stringify(covering.key)}`);
            }

            const skipped = indexes.filter(isProtected).filter((i) => i.name !== '_id_');
            if (skipped.length) {
                console.log(
                    `  (not considered: ${skipped.map((i) => i.name).join(', ')} — unique/TTL/partial/geo)`,
                );
            }
        }

        console.log('\n\n=== drop commands ===');
        if (!drops.length) {
            console.log('Nothing is redundant by prefix. Any unused index here is unused because');
            console.log('of how the app queries, not because another index covers it — decide');
            console.log('those case by case against audit-index-usage.js output.');
        } else {
            console.log('// Each of these is a strict key prefix of the index named after it,');
            console.log('// so the planner can already serve its queries. Safe to drop.\n');
            for (const d of drops) {
                console.log(`db.${d.coll}.dropIndex("${d.name}")   // covered by ${d.by}`);
            }
        }
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
