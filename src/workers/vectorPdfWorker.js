import { FlowProducer, Worker } from 'bullmq';
import { connection, VECTOR_PDF_QUEUE_NAME } from '../../queues/vectorQueue.js';
import VectorPrintJob from '../vectorModels/VectorPrintJob.js';
import { validateVectorMetadata } from '../vector/validation.js';
import { vectorLayoutEngine } from '../vector/vectorLayoutEngine.js';
import { uploadToS3WithKey } from '../services/s3.js';
import { stableStringify, verifyJobPayload, getStableHmacPayload } from '../services/hmac.js';
import os from 'os';
import { traceLog, traceWarn, traceError } from '../services/traceLog.js';

if (!process.env.JOB_PAYLOAD_HMAC_SECRET) {
  throw new Error('FATAL: JOB_PAYLOAD_HMAC_SECRET missing');
}

const REQUIRED_ENV = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'MONGO_URL',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error('[ENV_MISSING]', key);
  }
}

const DIAG_BULLMQ = String(process.env.DIAG_BULLMQ || '') === 'true';

let vectorFlowProducer = null;
let warnedRedisUnavailable = false;
let workersStarted = false;
let startedWorkers = [];

const lifecycleLog = (event, { traceId, printJobId, documentId, status, payload }) => {
  traceLog({
    traceId,
    jobId: String(printJobId || ''),
    event,
    payload: {
      documentId: String(documentId || ''),
      status: String(status || ''),
      ...(payload && typeof payload === 'object' ? payload : {}),
    },
  });
};

const getDocumentIdFromJobDoc = (jobDoc) =>
  String(jobDoc?.metadata?.documentId || jobDoc?.metadata?.sourcePdfKey || jobDoc?.sourcePdfKey || '').trim();

const mapErrorCode = (err, fallback) => {
  const msg = String(err?.message || '');
  if (msg === 'SVG_NORMALIZE_TIMEOUT') return 'TIMEOUT';
  if (/hmac/i.test(msg)) return 'HMAC_FAILED';
  if (/inkscape/i.test(msg)) return 'INKSCAPE_FAIL';
  if (/merge/i.test(msg)) return 'MERGE_FAIL';
  if (/vector metadata/i.test(msg)) return 'INVALID_INPUT';
  if (/SVG too complex/i.test(msg) || msg === 'SVG_TOO_COMPLEX') return 'SVG_TOO_COMPLEX';
  if (/SECURITY VIOLATION/i.test(msg)) return 'INVALID_OUTPUT';
  if (/timeout/i.test(msg)) return 'TIMEOUT';
  return String(fallback || 'UNKNOWN');
};

const discardInvalidLifecycle = async (job, { traceId, printJobId, documentId, status, expected }) => {
  try {
    await job.discard();
  } catch {
    // ignore
  }
  traceWarn({
    traceId,
    jobId: String(printJobId || ''),
    event: 'JOB_DISCARDED_INVALID_STATE',
    payload: {
      documentId: String(documentId || ''),
      status: String(status || ''),
      expected,
      bullmqJobId: String(job?.id || ''),
      name: String(job?.name || ''),
    },
  });
  throw new Error('Invalid lifecycle transition');
};

export const getVectorFlowProducer = () => {
  if (vectorFlowProducer) return vectorFlowProducer;
  try {
    vectorFlowProducer = new FlowProducer({ connection });
    vectorFlowProducer.on('error', (err) => {
      const code = err?.code || err?.errno;
      if (
        !warnedRedisUnavailable &&
        (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND')
      ) {
        warnedRedisUnavailable = true;
        console.warn('[vectorPdfWorker] Redis unavailable: BullMQ disabled', { code });
        return;
      }
      if (!warnedRedisUnavailable) {
        console.error('[vectorPdfWorker] FlowProducer error', err);
      }
    });
    return vectorFlowProducer;
  } catch (e) {
    if (!warnedRedisUnavailable) {
      warnedRedisUnavailable = true;
      console.warn('[vectorPdfWorker] Redis unavailable: BullMQ disabled');
    }
    vectorFlowProducer = null;
    return null;
  }
};

const lockKey = (documentId) => `vector:render:lock:${documentId}`;
const activeKey = () => 'vector:render:active';
const memberKey = (jobId) => `vector:render:active:${jobId}`;

const RELEASE_RENDER_LOCK_LUA = `
-- KEYS[1] = lock key
-- KEYS[2] = active counter key
-- KEYS[3] = membership key
-- ARGV[1] = jobId

local cur = redis.call('GET', KEYS[1])
if cur and tostring(cur) == tostring(ARGV[1]) then
  redis.call('DEL', KEYS[1])
end

if redis.call('EXISTS', KEYS[3]) == 1 then
  redis.call('DEL', KEYS[3])
  local active = tonumber(redis.call('GET', KEYS[2]) or '0')
  if active and active > 0 then
    redis.call('DECR', KEYS[2])
  end
end

return 1
`;

const releaseRenderLock = async ({ documentId, printJobId }) => {
  const redis = getRedisClient();
  if (!redis) return;
  if (!documentId || !printJobId) return;

  try {
    await redis.eval(
      RELEASE_RENDER_LOCK_LUA,
      3,
      lockKey(documentId),
      activeKey(),
      memberKey(printJobId),
      String(printJobId)
    );
  } catch {
    // ignore
  }
};

export const enqueueVectorJobFlow = async ({ printJobId, totalPages, traceId }) => {
  const producer = getVectorFlowProducer();
  if (!producer) {
    throw new Error('Redis unavailable: cannot enqueue vector jobs (BullMQ disabled)');
  }

  // Phase-3: template-based generation runs as a single job.
  // No per-page/per-batch worker fan-out.
  const total = Number(totalPages || 1);

  const flowSpec = {
    name: 'merge',
    queueName: VECTOR_PDF_QUEUE_NAME,
    data: { printJobId, traceId, totalPages: total },
    opts: { attempts: 1 },
  };

  lifecycleLog('VECTOR_FLOW_ENQUEUE', { traceId, printJobId, documentId: null, status: null, payload: { totalPages: total } });

  if (DIAG_BULLMQ) {
    traceLog({ traceId, jobId: String(printJobId || ''), event: 'FLOW_ADD_START', payload: { flowSpec } });
  }
  const out = await producer.add(flowSpec);
  if (DIAG_BULLMQ) {
    traceLog({ traceId, jobId: String(printJobId || ''), event: 'FLOW_ADD_DONE', payload: {} });
  }
  return out;
};

const waitForS3Key = async (key, timeoutMs) => {
  const bucket = String(process.env.S3_BUCKET || '').trim();
  if (!bucket) return;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  const delayMs = Math.max(250, Number(process.env.VECTOR_S3_WAIT_MS || 1000));

  while (Date.now() < deadline) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

const updateProgress = async (jobDoc, progress, event, details = null) => {
  jobDoc.progress = Math.max(0, Math.min(100, progress));
  jobDoc.audit.push({ event, details });
  await jobDoc.save();
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`[TIMEOUT] ${label} after ${ms}ms`));
      }, ms)
    ),
  ]);
}

const processPage = async (job) => {
  const { printJobId, pageIndex } = job.data || {};

  let jobDoc = await VectorPrintJob.findById(printJobId).exec();
  if (!jobDoc) {
    throw new Error('PrintJob not found');
  }

  const traceId = jobDoc?.traceId || (job?.data?.traceId ? String(job.data.traceId) : null);

  const documentId = getDocumentIdFromJobDoc(jobDoc);

  if (jobDoc.status === 'MERGE_RUNNING' || jobDoc.status === 'READY' || jobDoc.status === 'FAILED') {
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId,
      documentId,
      status: jobDoc.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  if (jobDoc.status === 'CREATED') {
    const now = new Date();
    const updated = await VectorPrintJob.findOneAndUpdate(
      { _id: printJobId, status: 'CREATED' },
      {
        $set: { status: 'BATCH_RUNNING', errorCode: null, errorAt: null, readyAt: null, batchStartedAt: now },
        $push: { lifecycleHistory: { from: 'CREATED', to: 'BATCH_RUNNING', at: now, source: 'batch-worker' } },
      },
      { new: true }
    )
      .exec()
      .catch(() => null);

    if (updated) {
      jobDoc = updated;
      lifecycleLog('BATCH_STARTED', { traceId, printJobId: jobDoc._id.toString(), documentId, status: jobDoc.status });
    } else {
      jobDoc = await VectorPrintJob.findById(printJobId).exec();
      if (!jobDoc) throw new Error('PrintJob not found');
    }
  }

  if (jobDoc.status !== 'BATCH_RUNNING') {
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId,
      documentId,
      status: jobDoc.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  const validation = validateVectorMetadata(jobDoc.metadata);
  if (!validation.isValid) {
    throw new Error('Invalid vector metadata');
  }

  if (!jobDoc.payloadHmac) {
    throw new Error('payloadHmac missing on job');
  }

  if (DIAG_BULLMQ) {
    traceLog({ traceId, jobId: jobDoc._id.toString(), event: 'HMAC_SKIP', payload: { stage: 'process-page' } });
  }

  const t0 = Date.now();

  const onePageDoc = await vectorLayoutEngine.createSinglePage(jobDoc.metadata, pageIndex);
  const pageBytes = await onePageDoc.save();
  const ms = Date.now() - t0;

  const header = Buffer.from(pageBytes.slice(0, 5)).toString();
  if (!header.startsWith('%PDF-')) {
    throw new Error('SECURITY VIOLATION: Output is not a valid PDF. Vector pipeline broken.');
  }

  const pct = Math.floor(((pageIndex + 1) / Math.max(1, jobDoc.totalPages)) * 80);
  await updateProgress(jobDoc, Math.max(jobDoc.progress, pct), 'PAGE_RENDERED', { pageIndex });

  jobDoc.audit.push({ event: 'PAGE_RENDER_TIME', details: { pageIndex, ms } });
  await jobDoc.save();

  const tmpKey = `documents/tmp/${printJobId}/page-${Number(pageIndex)}.pdf`;
  const uploaded = await uploadToS3WithKey(Buffer.from(pageBytes), 'application/pdf', tmpKey);
  return { pageIndex, key: uploaded.key };
};

const processBatch = async (job) => {
  const { printJobId, startPage, endPage, totalPages } = job.data || {};

  const traceIdFromJob = job?.data?.traceId ? String(job.data.traceId) : null;

  if (DIAG_BULLMQ) {
    traceLog({
      traceId: traceIdFromJob,
      jobId: String(printJobId || ''),
      event: 'BATCH_START',
      payload: { bullmqJobId: job?.id || null, range: { start: job.data?.startPage, end: job.data?.endPage } },
    });
  }

  const batchStart = Date.now();

  let jobDoc = await VectorPrintJob.findById(printJobId).exec();
  if (!jobDoc) {
    throw new Error('PrintJob not found');
  }

  const traceId = jobDoc?.traceId || traceIdFromJob;

  const documentId = getDocumentIdFromJobDoc(jobDoc);

  traceLog({
    traceId,
    jobId: String(printJobId || ''),
    event: 'BATCH_WORKER_CLAIMED',
    payload: { bullmqJobId: job?.id || null, range: { start: startPage, end: endPage }, totalPages: Number(totalPages || 0) || null },
  });

  if (jobDoc.status === 'MERGE_RUNNING' || jobDoc.status === 'READY' || jobDoc.status === 'FAILED') {
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId,
      documentId,
      status: jobDoc.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  if (jobDoc.status === 'CREATED') {
    const now = new Date();
    const updated = await VectorPrintJob.findOneAndUpdate(
      { _id: printJobId, status: 'CREATED' },
      {
        $set: { status: 'BATCH_RUNNING', errorCode: null, errorAt: null, readyAt: null, batchStartedAt: now },
        $push: { lifecycleHistory: { from: 'CREATED', to: 'BATCH_RUNNING', at: now, source: 'batch-worker' } },
      },
      { new: true }
    )
      .exec()
      .catch(() => null);

    if (updated) {
      jobDoc = updated;
      lifecycleLog('BATCH_STARTED', { traceId, printJobId: jobDoc._id.toString(), documentId, status: jobDoc.status });
    } else {
      jobDoc = await VectorPrintJob.findById(printJobId).exec();
      if (!jobDoc) throw new Error('PrintJob not found');
    }
  }

  if (jobDoc.status !== 'BATCH_RUNNING') {
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId,
      documentId,
      status: jobDoc.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  const validation = validateVectorMetadata(jobDoc.metadata);
  if (!validation.isValid) {
    throw new Error('Invalid vector metadata');
  }

  if (!jobDoc.payloadHmac) {
    throw new Error('payloadHmac missing on job');
  }

  if (DIAG_BULLMQ) {
    traceLog({ traceId, jobId: jobDoc._id.toString(), event: 'HMAC_SKIP', payload: { stage: 'process-batch' } });
  }

  const out = [];
  for (let pageIndex = Number(startPage); pageIndex < Number(endPage); pageIndex += 1) {
    const onePageDoc = await withTimeout(
      vectorLayoutEngine.createSinglePage(jobDoc.metadata, pageIndex),
      30_000,
      `vector render page ${pageIndex}`
    );
    const pageBytes = await withTimeout(
      onePageDoc.save(),
      20_000,
      `pdf save page ${pageIndex}`
    );

    const header = Buffer.from(pageBytes.slice(0, 5)).toString();
    if (!header.startsWith('%PDF-')) {
      throw new Error('SECURITY VIOLATION: Output is not a valid PDF. Vector pipeline broken.');
    }

    const tmpKey = `documents/tmp/${printJobId}/page-${Number(pageIndex)}.pdf`;
    const uploaded = await withTimeout(
      uploadToS3WithKey(Buffer.from(pageBytes), 'application/pdf', tmpKey),
      30_000,
      `s3 upload page ${pageIndex}`
    );
    out.push({ pageIndex, key: uploaded.key });

    const rendered = Math.min(Math.max(0, pageIndex + 1), Number(totalPages || jobDoc.totalPages || 1));
    const pct = Math.floor((rendered / Math.max(1, Number(totalPages || jobDoc.totalPages || 1))) * 80);
    await withTimeout(
      updateProgress(jobDoc, Math.max(jobDoc.progress, pct), 'PAGE_RENDERED', { pageIndex }),
      10_000,
      `progress update page ${pageIndex}`
    );
  }

  if (DIAG_BULLMQ) {
    traceLog({
      traceId,
      jobId: String(printJobId),
      event: 'VECTOR_BATCH_DONE',
      payload: { documentId, bullmqJobId: job?.id || null, pages: out.length, ms: Date.now() - batchStart },
    });
  }

  traceLog({ traceId, jobId: String(printJobId), event: 'BATCH_WORKER_DONE', payload: { documentId, ms: Date.now() - batchStart } });

  return { pages: out };
};

const processMerge = async (job) => {
  const traceIdFromJob = job?.data?.traceId ? String(job.data.traceId) : (job?.parent?.data?.traceId ? String(job.parent.data.traceId) : null);
  if (DIAG_BULLMQ) {
    traceLog({
      traceId: traceIdFromJob,
      jobId: job?.data?.printJobId ? String(job.data.printJobId) : 'unknown',
      event: 'PROCESS_MERGE_START',
      payload: { bullmqJobId: job?.id || null, parent: !!job.parent },
    });
  }

  const rootPrintJobId = job?.data?.printJobId ?? job?.parent?.data?.printJobId;
  if (!rootPrintJobId) {
    throw new Error('Missing root printJobId');
  }

  if (DIAG_BULLMQ) {
    traceLog({
      traceId: traceIdFromJob,
      jobId: String(rootPrintJobId),
      event: 'HMAC_ROOT_JOB',
      payload: { bullmqJobId: job?.id || null, isChild: !!job.parent },
    });
  }

  const jobDoc = await VectorPrintJob.findById(rootPrintJobId).exec();
  if (!jobDoc) {
    throw new Error('PrintJob not found');
  }

  const traceId = jobDoc?.traceId || traceIdFromJob;
  traceLog({ traceId, jobId: String(rootPrintJobId), event: 'MERGE_WORKER_CLAIMED', payload: { bullmqJobId: job?.id || null } });

  const documentId = getDocumentIdFromJobDoc(jobDoc);

  if (jobDoc.status !== 'BATCH_RUNNING' && jobDoc.status !== 'CREATED') {
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId: rootPrintJobId,
      documentId,
      status: jobDoc.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  if (jobDoc.status === 'FAILED') {
    return { skipped: true };
  }

  if (!jobDoc.payloadHmac) {
    throw new Error('payloadHmac missing on job');
  }

  const payload = getStableHmacPayload(jobDoc);
  if (String(rootPrintJobId) !== String(payload.jobId)) {
    throw new Error(`Root printJobId mismatch: rootPrintJobId=${String(rootPrintJobId)} payload.jobId=${String(payload.jobId)}`);
  }
  if (DIAG_BULLMQ) {
    traceLog({
      traceId,
      jobId: payload.jobId,
      event: 'HMAC_VERIFY_FINAL',
      payload: { stable: stableStringify(payload), expected: jobDoc.payloadHmac.slice(0, 8) },
    });
  }

  const isValid = verifyJobPayload(payload, jobDoc.payloadHmac);
  if (!isValid) {
    traceError({ traceId, jobId: jobDoc._id.toString(), event: 'HMAC_MISMATCH', payload: { jobId: jobDoc._id.toString() } });
    throw new Error('HMAC verification failed');
  }

  const mergeStart = Date.now();
  const maxMergeMs = Math.max(0, Number(process.env.VECTOR_MERGE_MAX_MS || 0));

  const now = new Date();
  const fromStatus = jobDoc.status === 'CREATED' ? 'CREATED' : 'BATCH_RUNNING';
  const transitioned = await VectorPrintJob.findOneAndUpdate(
    { _id: rootPrintJobId, status: fromStatus },
    {
      $set: {
        status: 'MERGE_RUNNING',
        errorCode: null,
        errorAt: null,
        readyAt: null,
        batchFinishedAt: fromStatus === 'BATCH_RUNNING' ? now : null,
        mergeStartedAt: now,
      },
      $push: { lifecycleHistory: { from: fromStatus, to: 'MERGE_RUNNING', at: now, source: 'merge-worker' } },
    },
    { new: true }
  )
    .exec()
    .catch(() => null);

  if (!transitioned) {
    const current = await VectorPrintJob.findById(rootPrintJobId).exec().catch(() => null);
    await discardInvalidLifecycle(job, {
      traceId,
      printJobId: rootPrintJobId,
      documentId,
      status: current?.status,
      expected: ['CREATED', 'BATCH_RUNNING'],
    });
  }

  if (fromStatus === 'BATCH_RUNNING') {
    lifecycleLog('BATCH_DONE', { traceId, printJobId: String(rootPrintJobId), documentId, status: 'BATCH_RUNNING' });
  }
  lifecycleLog('MERGE_STARTED', { traceId, printJobId: String(rootPrintJobId), documentId, status: 'MERGE_RUNNING' });

  if (DIAG_BULLMQ) {
    traceLog({
      traceId,
      jobId: String(rootPrintJobId),
      event: 'VECTOR_MERGE_STARTED',
      payload: { documentId, totalPages: Number(jobDoc.totalPages || 1) },
    });
  }

  try {
    await updateProgress(jobDoc, Math.max(jobDoc.progress, 80), 'MERGE_JOB_STARTED', null);

    const totalPages = Number(jobDoc.totalPages || 1);

    const pdf = await vectorLayoutEngine.createPage(jobDoc.metadata);
    const bytes = await pdf.save();

    const header = Buffer.from(bytes.slice(0, 5)).toString();
    if (!header.startsWith('%PDF-')) {
      throw new Error('SECURITY VIOLATION: Output is not a valid PDF. Vector pipeline broken.');
    }

    await updateProgress(jobDoc, Math.max(jobDoc.progress, 95), 'FINAL_RENDER_DONE', { totalPages });

    const renderMs = Date.now() - mergeStart;

    const finalKey =
      (typeof jobDoc.outputKey === 'string' && jobDoc.outputKey.trim())
        ? jobDoc.outputKey.trim()
        : `documents/final/${rootPrintJobId}.pdf`;
    if (DIAG_BULLMQ) {
      console.log(
        JSON.stringify({
          phase: 'merge',
          event: 'VECTOR_RENDER_DONE',
          documentId,
          jobId: String(rootPrintJobId),
          ms: renderMs,
          finalKey,
        })
      );
    }

    const { key, url } = await uploadToS3WithKey(Buffer.from(bytes), 'application/pdf', finalKey);

    const ttlHours = Number(process.env.FINAL_PDF_TTL_HOURS || 24);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const readyAt = new Date();
    const updateRes = await VectorPrintJob.updateOne(
      { _id: rootPrintJobId, status: 'MERGE_RUNNING' },
      {
        $set: {
          status: 'READY',
          readyAt,
          mergeFinishedAt: readyAt,
          errorCode: null,
          errorAt: null,
          progress: 100,
          output: { key, url, expiresAt },
        },
        $push: {
          audit: {
            $each: [
              { event: 'JOB_DONE', details: { key } },
              { event: 'MERGE_TIME', details: { ms: renderMs } },
            ],
          },
          lifecycleHistory: { from: 'MERGE_RUNNING', to: 'READY', at: readyAt, source: 'merge-worker' },
        },
      }
    )
      .exec()
      .catch(() => null);

    const modified = Number(updateRes?.modifiedCount || updateRes?.nModified || 0);
    if (!(modified > 0)) {
      const current = await VectorPrintJob.findById(rootPrintJobId).exec().catch(() => null);
      await discardInvalidLifecycle(job, {
        traceId,
        printJobId: rootPrintJobId,
        documentId,
        status: current?.status,
        expected: ['MERGE_RUNNING'],
      });
    }

    lifecycleLog('READY', { traceId, printJobId: String(rootPrintJobId), documentId, status: 'READY' });

    await releaseRenderLock({ documentId, printJobId: String(rootPrintJobId) });
    return { ok: true, key };
  } catch (e) {
    await releaseRenderLock({ documentId, printJobId: String(rootPrintJobId) });
    throw e;
  }
};

export const startVectorPdfWorkers = () => {
  if (workersStarted) return startedWorkers;

  const count = Math.max(1, Number(process.env.WORKER_COUNT || 1));
  const workers = [];

  try {
    const cpuCount = Array.isArray(os.cpus?.()) ? os.cpus().length : 1;
    const configuredConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1));
    if (configuredConcurrency > cpuCount) {
      console.warn('[WORKER_CONCURRENCY_WARNING]', { WORKER_CONCURRENCY: configuredConcurrency, cpuCount });
    }
  } catch {
    // ignore
  }

  if (!connection) {
    console.warn('[Workers] Redis unavailable; workers not started');
    workersStarted = true;
    startedWorkers = workers;
    return startedWorkers;
  }

  console.log(`[Workers] Starting ${count} vector worker(s)...`);

  if (DIAG_BULLMQ) {
    console.log('[QUEUE_NAME][WORKER]', VECTOR_PDF_QUEUE_NAME);
    try {
      console.log('[REDIS_CONN][WORKER]', connection?.options);
    } catch {
      console.log('[REDIS_CONN][WORKER]', null);
    }
    console.log('[WORKER_CONCURRENCY]', 1);
  }

  for (let i = 0; i < count; i += 1) {
    let worker = null;
    try {
      const concurrency = 1;
      worker = new Worker(
        VECTOR_PDF_QUEUE_NAME,
        async (job) => {
          if (DIAG_BULLMQ) {
            console.log('[WORKER_JOB_DISPATCH]', job?.name, job?.id);
          }
          if (job.name === 'batch') return processBatch(job);
          if (job.name === 'merge') return processMerge(job);
          traceWarn({
            traceId: job?.data?.traceId ? String(job.data.traceId) : null,
            jobId: job?.data?.printJobId ? String(job.data.printJobId) : 'unknown',
            event: 'WORKER_UNKNOWN_JOB',
            payload: { name: job?.name || null, id: job?.id || null },
          });
          try {
            await job.discard();
          } catch {
            // ignore
          }
          throw new Error(`Unknown job type: ${job.name}`);
        },
        { connection, concurrency }
      );

      console.log('[WORKER_ATTACHED]', {
        queue: VECTOR_PDF_QUEUE_NAME,
        concurrency,
      });
    } catch (e) {
      if (!warnedRedisUnavailable) {
        warnedRedisUnavailable = true;
        console.warn('[Workers] Redis unavailable; workers not started');
      }
      workersStarted = true;
      startedWorkers = workers;
      return startedWorkers;
    }

    worker.on('failed', async (job, err) => {
      if (DIAG_BULLMQ) {
        console.log('[WORKER_EVENT_FAILED]', { name: job?.name, id: job?.id, message: err?.message || null });
      }
      const printJobId = job?.data?.printJobId;
      if (!printJobId) return;

      const errMsg = String(err?.message || '');
      if (errMsg === 'Invalid lifecycle transition') {
        try {
          await job.discard();
        } catch {
          // ignore
        }
        return;
      }

      const attempts = Number(job?.opts?.attempts || 1);
      const attemptsMade = Number(job?.attemptsMade || 0);
      const isFinalFailure = attemptsMade >= attempts;

      const jobDoc = await VectorPrintJob.findById(printJobId).exec().catch(() => null);
      if (!jobDoc) return;

      const traceId = jobDoc?.traceId || (job?.data?.traceId ? String(job.data.traceId) : null);

      if (jobDoc.status === 'READY') {
        try {
          await job.discard();
        } catch {
          // ignore
        }
        return;
      }

      const fromStatus = String(jobDoc.status || '');
      const now = new Date();
      jobDoc.status = 'FAILED';
      jobDoc.errorAt = now;
      jobDoc.errorCode = mapErrorCode(err, 'UNKNOWN');
      jobDoc.error = { message: err?.message || 'Job failed', stack: err?.stack || null };
      jobDoc.audit.push({ event: 'JOB_FAILED', details: { bullmqJobId: job.id, name: job.name } });
      if (isFinalFailure) {
        jobDoc.lifecycleHistory.push({
          from: fromStatus,
          to: 'FAILED',
          at: now,
          source: job?.name === 'merge' ? 'merge-worker' : 'batch-worker',
        });
      }
      await jobDoc.save();

      const documentId = getDocumentIdFromJobDoc(jobDoc);
      lifecycleLog('FAILED', { traceId, printJobId: jobDoc._id.toString(), documentId, status: jobDoc.status });

      if (isFinalFailure) {
        const documentId = getDocumentIdFromJobDoc(jobDoc);
        await releaseRenderLock({ documentId, printJobId: String(printJobId) });
        if (DIAG_BULLMQ) {
          console.log(
            JSON.stringify({
              phase: 'fail',
              event: 'VECTOR_JOB_FAILED',
              documentId,
              jobId: String(printJobId),
              jobName: job?.name,
            })
          );
        }
      }
    });

    let readyLogged = false;
    worker.on('ready', () => {
      if (readyLogged) return;
      readyLogged = true;
      console.log(`[VectorWorker-${i + 1}] Connected to Redis`);
      console.log(`[VectorWorker-${i + 1}] Ready and waiting for jobs`);
    });

    worker.on('completed', (job) => {
      if (!DIAG_BULLMQ) return;
      console.log('[WORKER_EVENT_COMPLETED]', { name: job?.name, id: job?.id });
    });

    worker.on('error', (err) => {
      if (DIAG_BULLMQ) {
        console.log('[WORKER_EVENT_ERROR]', { message: err?.message || null, code: err?.code || err?.errno || null });
      }
      const code = err?.code || err?.errno;
      if (code) {
        console.warn(`[VectorWorker-${i + 1}] Redis error`, { code });
        return;
      }
      console.warn(`[VectorWorker-${i + 1}] Worker error`, err);
    });

    workers.push(worker);
  }

  if (workers.length > 0) {
    console.log(`[Workers] Started ${workers.length} vector worker(s)`);
  } else {
    console.warn('[Workers] No workers started');
  }

  workersStarted = true;
  startedWorkers = workers;
  return startedWorkers;
};
