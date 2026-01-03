import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const mongoUrl = typeof process.env.MONGO_URL === 'string' ? process.env.MONGO_URL.trim() : '';
  if (!mongoUrl) {
    throw new Error('MONGO_URL not set');
  }

  await mongoose.connect(mongoUrl);
  console.log('[Mongo] Connected');

  const res = await mongoose.connection
    .collection('vector_printjobs')
    .deleteMany({});

  console.log('[Cleanup] Deleted VectorPrintJobs:', res.deletedCount);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
