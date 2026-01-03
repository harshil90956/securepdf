import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { setRedisConnection, connection } from '../queues/vectorQueue.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.JOB_PAYLOAD_HMAC_SECRET) {
  throw new Error('FATAL: JOB_PAYLOAD_HMAC_SECRET missing');
}

const app = express();
const PORT = process.env.PORT || 8000;
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // If request has an Origin header, reflect it back
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-Token'
  );
  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  res.header('Access-Control-Expose-Headers', 'X-Source-Key');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

const BODY_LIMIT = process.env.BODY_LIMIT || '500mb';

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

/* -------------------------------- start ---------------------------------- */

async function start() {
  const { default: bcrypt } = await import('bcryptjs');
  const { default: VectorUser } = await import('./vectorModels/VectorUser.js');
  const { default: authRoutes } = await import('./routes/auth.js');
  const { default: adminRoutes } = await import('./routes/admin.js');
  const { default: adminUsersRoutes } = await import('./routes/adminUsers.js');
  const { default: docsRoutes } = await import('./routes/docs.js');
  const { default: vectorRoutes } = await import('./routes/vectorRoutes.js');
  const { default: vectorJobRoutes } = await import('./routes/vectorJobRoutes.js');
  const { default: printRoutes } = await import('./routes/printRoutes.js');
  const { default: fontsRoutes } = await import('./routes/fonts.js');
  const { default: downloadRoutes } = await import('./routes/downloadRoutes.js');
  const { default: normalizeSvgRoutes } = await import('./routes/normalizeSvg.js');
  const { default: overlayRoutes } = await import('./routes/overlayRoutes.js');
  const { startTerminalJobPurgeLoop } = await import('./services/jobCleanup.js');
  const { pingPrintEngineHealth } = await import('./services/printEngineClient.js');

  const ensureAdminUser = async () => {
    const email = process.env.ADMIN_SEED_EMAIL?.trim();
    const pass = process.env.ADMIN_SEED_PASSWORD;

    if (!email || !pass) {
      console.warn('[AdminSeed] skipped (env not set)');
      return;
    }

    const count = await mongoose.connection.db
      .collection('users')
      .estimatedDocumentCount()
      .catch(() => 0);

    if (count > 0) return;

    const exists = await VectorUser.findOne({ email: email.toLowerCase() });
    if (exists) return;

    const hash = await bcrypt.hash(pass, 10);
    await VectorUser.create({
      email: email.toLowerCase(),
      passwordHash: hash,
      role: 'admin',
    });
  };

  const mongoUrl = process.env.MONGO_URL?.trim();
  if (!mongoUrl) {
    console.error('[MongoDB] MONGO_URL not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 5000 });
    console.log('[MongoDB] connected');
    await ensureAdminUser();
  } catch (e) {
    console.error('[MongoDB] connect failed', { message: e?.message || 'unknown' });
    process.exit(1);
  }

  const printEngineUrl = String(process.env.PRINT_ENGINE_URL || '').trim();
  console.log('[PrintEngine] PRINT_ENGINE_URL', { url: printEngineUrl || null });
  if (!printEngineUrl) {
    console.error('[PrintEngine] FATAL: PRINT_ENGINE_URL not configured');
    process.exit(1);
  }

  try {
    await pingPrintEngineHealth();
    console.log('[PrintEngine] health OK');
  } catch (e) {
    console.error('[PrintEngine] FATAL: health check failed', { message: e?.message || 'unknown' });
    process.exit(1);
  }

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      backendVersion: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown',
      workersEnabled: false,
      ipSecurityEnabled: false,
      redisAvailable: Boolean(connection),
      inkscapeAvailable: null,
    });
  });

  app.use((req, res, next) => {
    const version =
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      'unknown';

    res.setHeader('X-Backend-Version', version);
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin', adminUsersRoutes);
  app.use('/api/docs', docsRoutes);
  app.use('/api/vector', vectorRoutes);
  app.use('/api/vector', vectorJobRoutes);
  app.use('/api', normalizeSvgRoutes);
  app.use('/api', fontsRoutes);
  app.use('/api', printRoutes);
  app.use('/api/overlays', overlayRoutes);
  app.use('/api/download', downloadRoutes);

  const redisUrl = typeof process.env.REDIS_URL === 'string' ? process.env.REDIS_URL.trim() : '';
  if (!redisUrl) {
    console.warn('[Redis] REDIS_URL not set (workers/queues disabled)');
    setRedisConnection(null);
  } else {
    try {
      const redisTlsEnabled =
        String(process.env.REDIS_TLS || '').toLowerCase() === 'true' ||
        redisUrl.startsWith('rediss://');

      const redis = new Redis(redisUrl, {
        ...(redisTlsEnabled ? { tls: {} } : {}),
        enableReadyCheck: true,
        maxRetriesPerRequest: null,
      });

      redis.on('ready', () => {
        console.log('[Redis] Connected');

        try {
          const host = typeof redis?.options?.host === 'string' ? redis.options.host : '';
          const isPrivateHost =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

          if (!isPrivateHost) {
            redis
              .config('GET', 'protected-mode')
              .then((out) => {
                const v = Array.isArray(out) && out.length >= 2 ? String(out[1] || '').toLowerCase() : '';
                if (v === 'no' || v === 'false' || v === '0') {
                  console.warn('[REDIS_PROTECTED_MODE_WARNING]', { host, protectedMode: v });
                }
              })
              .catch(() => null);
          }
        } catch {
          // ignore
        }
      });

      let warned = false;
      redis.on('error', (err) => {
        if (warned) return;
        warned = true;
        const code = err?.code || err?.errno;
        console.warn('[Redis] Error (non-fatal)', { code: code || 'unknown' });
        setTimeout(() => {
          warned = false;
        }, 10_000);
      });

      setRedisConnection(redis);
    } catch (e) {
      console.warn('[Redis] non-fatal:', e?.message);
      setRedisConnection(null);
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Backend listening on port ${PORT}`);
  });

  server.on('clientError', (err, socket) => {
    if (err?.code === 'ECONNRESET' || err?.code === 'EPIPE') {
      try { socket.destroy(); } catch {}
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  try {
    startTerminalJobPurgeLoop();
  } catch {}
}

start();
