// Restaurant listing is now zone-scoped (GET /food/restaurant/restaurants filters
// by FoodRestaurant.zoneId when the caller passes zoneId). zoneId is normally set
// automatically whenever a restaurant's location is saved (see
// updateRestaurantProfile in restaurant.service.js), but any restaurant whose
// location was set before that logic existed still has zoneId: null and would
// silently drop out of every zone-scoped listing. Run this once after deploying
// the zone-filter change to backfill those.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { isPointInZonePolygon } from '../src/modules/food/restaurant/services/restaurant.service.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const main = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');

  await mongoose.connect(mongoUri);

  try {
    const activeZones = await FoodZone.find({ isActive: true }).select('_id coordinates').lean();
    console.log(`Active zones: ${activeZones.length}`);

    const cursor = FoodRestaurant.find({ zoneId: null })
      .select('_id location.latitude location.longitude')
      .lean()
      .cursor();

    let scanned = 0;
    let matched = 0;
    let unmatched = 0;
    let noLocation = 0;

    for await (const r of cursor) {
      scanned += 1;
      const lat = Number(r?.location?.latitude);
      const lng = Number(r?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        noLocation += 1;
        continue;
      }

      const zone = activeZones.find((z) => isPointInZonePolygon(lat, lng, z?.coordinates));
      if (!zone) {
        unmatched += 1;
        continue;
      }

      await FoodRestaurant.updateOne({ _id: r._id }, { $set: { zoneId: zone._id } });
      matched += 1;
    }

    const totalApproved = await FoodRestaurant.countDocuments({ status: 'approved' });
    const totalWithZone = await FoodRestaurant.countDocuments({ status: 'approved', zoneId: { $ne: null } });

    console.log('Zone backfill completed');
    console.log({ scanned, matched, unmatched, noLocation });
    console.log(`Approved restaurants with a zoneId now: ${totalWithZone} / ${totalApproved}`);
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((err) => {
  console.error('Script failed:', err?.message || err);
  process.exitCode = 1;
});
