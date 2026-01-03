import crypto from 'crypto';

export const stableStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;

  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(',')}}`;
};

// ⚠️ DO NOT MODIFY HMAC PAYLOAD
// Any additional field will break verification
export function getStableHmacPayload(jobDoc) {
  if (!jobDoc || !jobDoc._id) {
    throw new Error('Invalid jobDoc for canonical HMAC payload');
  }

  const outputKey =
    (jobDoc?.metadata && typeof jobDoc.metadata.outputKey === 'string' && jobDoc.metadata.outputKey.trim()) ||
    (jobDoc?.hmacPayload && typeof jobDoc.hmacPayload.outputKey === 'string' && jobDoc.hmacPayload.outputKey.trim()) ||
    (typeof jobDoc.outputKey === 'string' && jobDoc.outputKey.trim()) ||
    null;

  if (!outputKey || typeof outputKey !== 'string') {
    throw new Error('outputKey missing on job');
  }
  if (!(jobDoc.createdAt instanceof Date)) {
    throw new Error('createdAt missing on job');
  }

  return {
    jobId: jobDoc._id.toString(),
    outputKey,
    createdAt: jobDoc.createdAt.toISOString(),
  };
}

export function canonicalizePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

export function signJobPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('HMAC payload must be a plain object');
  }

  if (payload.pages || payload.seriesConfig || payload.placementRules) {
    throw new Error('HMAC payload must be immutable only');
  }

  const secret = process.env.JOB_PAYLOAD_HMAC_SECRET;
  if (!secret) {
    throw new Error('JOB_PAYLOAD_HMAC_SECRET not configured');
  }

  const payloadString = stableStringify(payload);

  console.log('[HMAC_SIGN_DEBUG]', {
    stable: payloadString,
    secretLen: process.env.JOB_PAYLOAD_HMAC_SECRET?.length,
  });

  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

export function verifyJobPayload(payload, expectedHmac) {
  if (typeof expectedHmac !== 'string' || !expectedHmac) return false;

  console.log('[HMAC_VERIFY_DEBUG]', {
    stable: stableStringify(payload),
    secretLen: process.env.JOB_PAYLOAD_HMAC_SECRET?.length,
  });

  const actualHmac = signJobPayload(payload);
  const a = Buffer.from(actualHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
