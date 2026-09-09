// Squares up the two name fields on zones.
//
// A zone carries both `name` (required by the schema, indexed, what the admin
// panel's zone list renders, and what the create/update path treats as
// canonical) and `zoneName` (optional, normally a mirror of `name`).
//
// On zones created before the current admin form, the two drifted: `name` held
// the real label ("Vijay Nagar Core") while `zoneName` held a generic
// placeholder ("Zone 1"). Anything reading `zoneName` therefore showed the
// placeholder — that is what the driver app's zone picker was doing.
//
// The read paths now prefer `name`, so this is not required for correctness;
// it removes the trap for the next thing that reads `zoneName`.
//
// Safe with respect to filtering: the report endpoints match a zone by
// { $or: [{ name }, { zoneName }] } and their dropdowns are rebuilt from the
// API on every load, so no stored filter value goes stale.
//
// Dry run by default. Pass --apply to write.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const main = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

    const apply = process.argv.includes('--apply');
    await mongoose.connect(mongoUri);

    try {
        const zones = await FoodZone.find({}).select('name zoneName').lean();
        console.log(`Zones: ${zones.length}\n`);

        let changed = 0;
        let skipped = 0;

        for (const z of zones) {
            const name = String(z.name || '').trim();
            const zoneName = String(z.zoneName || '').trim();

            if (!name) {
                // `name` is schema-required, so this should not happen — but
                // overwriting a real zoneName with an empty name would destroy
                // the only label the zone has.
                console.log(`REFUSE  ${z._id}  name is empty, zoneName="${zoneName}"`);
                skipped += 1;
                continue;
            }
            if (name === zoneName) {
                skipped += 1;
                continue;
            }

            if (!apply) {
                console.log(`DRY RUN ${z._id}  zoneName "${zoneName}" -> "${name}"`);
            } else {
                await FoodZone.updateOne({ _id: z._id }, { $set: { zoneName: name } });
                console.log(`UPDATED ${z._id}  zoneName "${zoneName}" -> "${name}"`);
            }
            changed += 1;
        }

        console.log(`\n${changed} to change, ${skipped} already consistent or skipped.`);
        if (!apply && changed) console.log('Nothing written. Re-run with --apply.');
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
