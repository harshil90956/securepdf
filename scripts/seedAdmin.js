import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import VectorUser from '../src/vectorModels/VectorUser.js';

dotenv.config();

const EMAIL = 'akshit@gmail.com';
const PASSWORD = 'akshit';

const main = async () => {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error('MONGO_URL is required');
  }

  await mongoose.connect(mongoUrl);

  const email = EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const updated = await VectorUser.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        passwordHash,
        role: 'admin',
        'security.isLocked': false,
        'security.lockUntil': null,
        'security.failedLoginAttempts': 0,
      },
    },
    { upsert: true, new: true }
  );

  console.log('[seedAdmin] ok', { id: updated._id.toString(), email: updated.email, role: updated.role });
};

main()
  .then(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seedAdmin] failed', { message: err?.message || String(err) });
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
