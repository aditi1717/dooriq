const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

async function checkSubadmin() {
  if (!mongoUri) {
    console.error('MONGO_URI/MONGODB_URI not found in environment');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const adminCollection = mongoose.connection.collection('food_admins');
    const user = await adminCollection.findOne({ email: 'kurilaman21@gmail.com' });

    if (user) {
      console.log('--- Sub-Admin Found ---');
      console.log('ID:', user._id);
      console.log('Name:', user.name);
      console.log('Email:', user.email);
      console.log('Phone:', user.phone);
      console.log('adminType:', user.adminType);
      console.log('isActive:', user.isActive);
      console.log('isDeleted:', user.isDeleted);
      console.log('Password Hash:', user.password);
    } else {
      console.log('Sub-admin kurilaman21@gmail.com NOT found in database.');
    }
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await mongoose.disconnect();
  }
}

checkSubadmin();
