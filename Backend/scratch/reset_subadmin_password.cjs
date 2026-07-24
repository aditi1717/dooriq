const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const newPasswordText = 'Aman@12345';

async function resetPassword() {
  if (!mongoUri) {
    console.error('MONGO_URI/MONGODB_URI not found in environment');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const adminCollection = mongoose.connection.collection('food_admins');
    const user = await adminCollection.findOne({ email: 'kurilaman21@gmail.com' });

    if (!user) {
      console.log('Sub-admin kurilaman21@gmail.com not found.');
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPasswordText, salt);

    await adminCollection.updateOne(
      { _id: user._id },
      { $set: { password: passwordHash } }
    );

    console.log(`Successfully reset password for ${user.email} to: ${newPasswordText}`);
  } catch (err) {
    console.error('Error resetting password:', err);
  } finally {
    await mongoose.disconnect();
  }
}

resetPassword();
