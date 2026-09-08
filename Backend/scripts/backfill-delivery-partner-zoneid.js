// Dispatch now only offers an order to delivery partners whose zoneId matches
// the order's zoneId (order-dispatch.service.js). zoneId is a brand-new field
// on FoodDeliveryPartner — every existing partner has it null and would stop
// receiving orders entirely the moment that filter goes live. This backfills
// zoneId from each partner's last known GPS fix (lastLat/lastLng), the same
// point-in-polygon match used for restaurants. Run once, then delete.
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodDeliveryPartner } from '../src/modules/food/delivery/models/deliveryPartner.model.js';
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

    const cursor = FoodDeliveryPartner.find({ zoneId: null })
      .select('_id lastLat lastLng status')
      .lean()
      .cursor();

    let scanned = 0;
    let matched = 0;
    let unmatched = 0;
    let noLocation = 0;

    for await (const p of cursor) {
      scanned += 1;
      const lat = Number(p?.lastLat);
      const lng = Number(p?.lastLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        noLocation += 1;
        continue;
      }

      const zone = activeZones.find((z) => isPointInZonePolygon(lat, lng, z?.coordinates));
      if (!zone) {
        unmatched += 1;
        continue;
      }

      await FoodDeliveryPartner.updateOne({ _id: p._id }, { $set: { zoneId: zone._id } });
      matched += 1;
    }

    const totalApproved = await FoodDeliveryPartner.countDocuments({ status: 'approved' });
    const totalWithZone = await FoodDeliveryPartner.countDocuments({ status: 'approved', zoneId: { $ne: null } });

    console.log('Delivery partner zone backfill completed');
    console.log({ scanned, matched, unmatched, noLocation });
    console.log(`Approved partners with a zoneId now: ${totalWithZone} / ${totalApproved}`);
    if (totalWithZone < totalApproved) {
      console.log(
        `${totalApproved - totalWithZone} approved partner(s) still have no zoneId (no GPS fix, or GPS outside every zone) — ` +
        `they will not be offered any zone-restricted order until they set one via the app's "Change Zone" profile option.`
      );
    }
  } finally {
    await mongoose.connection.close();
  }
};

main().catch((err) => {
  console.error('Script failed:', err?.message || err);
  process.exitCode = 1;
});
