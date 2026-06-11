const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const adminEmail = 'admin@gmail.com';
const adminPassword = 'admin@123';
const adminName = 'Super Admin';

async function seedAdmin() {
  if (!mongoUri) {
    throw new Error('Missing MONGO_URI/MONGODB_URI in Backend/.env');
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const adminCollection = mongoose.connection.collection('food_admins');
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const now = new Date();

    const result = await adminCollection.updateOne(
      { email: adminEmail },
      {
        $set: {
          email: adminEmail,
          password: passwordHash,
          name: adminName,
          phone: '',
          profileImage: '',
          fcmTokens: [],
          fcmTokenMobile: [],
          role: 'ADMIN',
          adminType: 'super_admin',
          isActive: true,
          isDeleted: false,
          servicesAccess: ['food', 'quickCommerce', 'taxi'],
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      console.log(`Created new admin account: ${adminEmail}`);
    } else {
      console.log(`Updated existing admin account: ${adminEmail}`);
    }

    console.log(`Admin login seeded with email: ${adminEmail}`);
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedAdmin();
