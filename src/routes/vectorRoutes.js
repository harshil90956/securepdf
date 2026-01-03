import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import VectorPrintJob from '../vectorModels/VectorPrintJob.js';
import { signJobPayload, getStableHmacPayload } from '../services/hmac.js';
import crypto from 'crypto';
import VectorUser from '../vectorModels/VectorUser.js';
import VectorDocument from '../vectorModels/VectorDocument.js';
import VectorDocumentAccess from '../vectorModels/VectorDocumentAccess.js';
import { traceLog } from '../services/traceLog.js';
import { renderViaPrintEngine } from '../services/printEngineClient.js';

const router = express.Router();

// POST /api/vector/generate - Vector-only PDF generation
router.post('/generate', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const job_id = typeof body.job_id === 'string' ? body.job_id.trim() : '';
    const svg_s3_key = typeof body.svg_s3_key === 'string' ? body.svg_s3_key.trim() : '';
    const series = body.series && typeof body.series === 'object' ? body.series : null;
    const object_mm = body.object_mm && typeof body.object_mm === 'object' ? body.object_mm : null;
    const custom_fonts = Array.isArray(body.custom_fonts) ? body.custom_fonts : null;
    const overlays = Array.isArray(body.overlays) ? body.overlays : null;
    const requestedMode = typeof body.render_mode === 'string' && body.render_mode.trim() ? body.render_mode.trim() : 'exact_mm';
    const render_mode = ['deterministic_outlined', 'deterministic_outlined_4up'].includes(String(requestedMode)) ? 'exact_mm' : requestedMode;

    if (!job_id) {
      return res.status(400).json({ message: 'job_id is required' });
    }
    if (!svg_s3_key) {
      return res.status(400).json({ message: 'svg_s3_key is required' });
    }
    if (!series) {
      return res.status(400).json({ message: 'series is required' });
    }

    const anchorSpace = typeof series.anchor_space === 'string' ? String(series.anchor_space).trim().toLowerCase() : '';
    const xMm = Number(series.x_mm);
    const yMm = Number(series.y_mm);
    const fontFamily = typeof series.font_family === 'string' ? String(series.font_family).trim() : '';
    const fontSizeMm = Number(series.font_size_mm);
    const perLetterFontSizeMm = series.per_letter_font_size_mm;
    const letterSpacingMm = Number(series.letter_spacing_mm);
    const seriesRotationDeg = Number(series.rotation_deg);
    const seriesColor = typeof series.color === 'string' ? String(series.color).trim() : '';
    const hasDisallowed =
      series.x_ratio !== undefined ||
      series.y_ratio !== undefined ||
      series.x_svg !== undefined ||
      series.y_svg !== undefined ||
      series.font !== undefined ||
      series.per_letter !== undefined;

    const perLetterOk =
      perLetterFontSizeMm === undefined ||
      (Array.isArray(perLetterFontSizeMm) && perLetterFontSizeMm.every((v) => Number.isFinite(Number(v)) && Number(v) > 0));

    if (
      anchorSpace !== 'object_mm' ||
      !Number.isFinite(xMm) ||
      !Number.isFinite(yMm) ||
      !fontFamily ||
      !Number.isFinite(fontSizeMm) ||
      !(fontSizeMm > 0) ||
      !perLetterOk ||
      !Number.isFinite(letterSpacingMm) ||
      !Number.isFinite(seriesRotationDeg) ||
      !seriesColor ||
      hasDisallowed
    ) {
      return res
        .status(400)
        .json({ message: 'series must use anchor_space="object_mm" with x_mm/y_mm, font_family, font_size_mm, optional per_letter_font_size_mm, letter_spacing_mm, rotation_deg, color (no x_ratio/y_ratio/x_svg/y_svg, no font, no per_letter)' });
    }

    const createdAt = new Date();
    const traceId = crypto.randomUUID();

    const printJobId = new VectorPrintJob()._id;
    const outputKey = `documents/final/${job_id}.pdf`;

    const jobDoc = new VectorPrintJob({
      _id: printJobId,
      traceId,
      userId: req.user._id,
      sourcePdfKey: svg_s3_key,
      metadata: {
        job_id,
        svg_s3_key,
        object_mm,
        series,
        render_mode,
        outputKey,
      },
      status: 'CREATED',
      progress: 0,
      totalPages: 1,
      audit: [{ event: 'JOB_CREATED', details: { svg_s3_key } }],
      createdAt,
    });

    const hmacPayload = getStableHmacPayload(jobDoc);
    jobDoc.hmacPayload = hmacPayload;
    const payloadHmac = signJobPayload(hmacPayload);
    jobDoc.payloadHmac = payloadHmac;
    await jobDoc.save();

    traceLog({ traceId, jobId: jobDoc._id.toString(), event: 'JOB_CREATED', payload: { svg_s3_key, status: jobDoc.status } });

    const renderStart = Date.now();
    const peRes = await renderViaPrintEngine({
      job_id,
      svg_s3_key,
      object_mm,
      series,
      custom_fonts,
      overlays,
      render_mode,
      traceId,
    });

    console.log('[PRINT_ENGINE_RESPONSE]', {
      traceId,
      jobId: printJobId.toString(),
      status: peRes?.status || null,
      pdf_s3_key: peRes?.pdf_s3_key || null,
    });

    const pdf_s3_key = typeof peRes?.pdf_s3_key === 'string' ? peRes.pdf_s3_key : '';
    if (!pdf_s3_key) {
      throw new Error('Missing pdf_s3_key from print-engine');
    }

    const engine_metrics = peRes?.engine_metrics && typeof peRes.engine_metrics === 'object' ? peRes.engine_metrics : null;

    const readyAt = new Date();
    await VectorPrintJob.updateOne(
      { _id: jobDoc._id },
      {
        $set: {
          status: 'READY',
          readyAt,
          progress: 100,
          output: { key: pdf_s3_key, url: null, expiresAt: null },
        },
        $push: {
          audit: { $each: [{ event: 'JOB_DONE', details: { key: pdf_s3_key, ms: Date.now() - renderStart } }] },
          lifecycleHistory: { from: 'CREATED', to: 'READY', at: readyAt, source: 'api' },
        },
      }
    ).exec();

    traceLog({ traceId, jobId: jobDoc._id.toString(), event: 'VECTOR_GENERATE_DONE', payload: { pdf_s3_key, ms: Date.now() - renderStart } });

    return res.status(201).json({ jobId: jobDoc._id, pdf_s3_key, engine_metrics });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Vector PDF generation failed' });
  }
});

router.get('/file', authMiddleware, async (req, res) => {
  return res.status(410).json({ message: 'Deprecated. Use /api/download/:s3_key' });
});

// POST /api/vector/assign - Assign a generated PDF to a user with print limit
router.post('/assign', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userEmail = typeof req.body?.userEmail === 'string' ? req.body.userEmail.trim() : '';
    const s3Key = typeof req.body?.s3Key === 'string' ? req.body.s3Key.trim() : '';
    const printLimit = Number(req.body?.printLimit);

    if (!userEmail || !s3Key || !Number.isFinite(printLimit)) {
      return res.status(400).json({ message: 'userEmail, s3Key, and printLimit are required' });
    }

    if (printLimit < 1) {
      return res.status(400).json({ message: 'printLimit must be at least 1' });
    }

    const targetUser = await VectorUser.findOne({ email: userEmail.toLowerCase() }).exec();
    if (!targetUser) {
      return res.status(404).json({ message: 'User with this email not found' });
    }

    const allowedPrefix = 'documents/final/';
    if (!s3Key.startsWith(allowedPrefix)) {
      return res.status(403).json({ message: 'Not authorized to assign this PDF key' });
    }

    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      return res.status(500).json({ message: 'S3 not configured' });
    }

    const fileUrl = `s3://${bucket}/${s3Key}`;

    const doc = await VectorDocument.create({
      title: 'Generated Output',
      fileKey: s3Key,
      fileUrl,
      sourceFileKey: null,
      sourceMimeType: null,
      totalPrints: Number(printLimit),
      createdBy: req.user._id,
      mimeType: 'application/pdf',
      documentType: 'generated-output',
    });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const access = await VectorDocumentAccess.findOneAndUpdate(
      { userId: targetUser._id, documentId: doc._id },
      {
        userId: targetUser._id,
        documentId: doc._id,
        assignedQuota: Number(printLimit),
        printQuota: Number(printLimit),
        printsUsed: 0,
        usedPrints: 0,
        revoked: false,
        sessionToken,
      },
      { upsert: true, new: true }
    ).exec();

    return res.json({
      message: 'PDF assigned successfully',
      documentId: doc._id,
      accessId: access._id,
      sessionToken: access.sessionToken,
    });
  } catch (err) {
    console.error('Assign error:', err);
    return res.status(500).json({ message: err?.message || 'Assignment failed' });
  }
});

// POST /api/vector/validate - Validate vector metadata
router.post('/validate', authMiddleware, async (req, res) => {
  try {
    const metadata = req.body;
    const validation = validateVectorMetadata(metadata);
    
    return res.json({
      valid: validation.isValid,
      errors: validation.errors
    });
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ 
      message: 'Validation failed',
      error: error.message 
    });
  }
});

export default router;
