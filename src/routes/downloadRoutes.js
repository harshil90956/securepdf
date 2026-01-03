import express from 'express';
import { s3 } from '../services/s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/download/enacle-app - Stream Enacle-app.exe from S3
router.get('/enacle-app', async (req, res) => {
  try {
    const s3Bucket = String(process.env.S3_BUCKET || '').trim();
    const downloadBucketOverride = String(process.env.DOWNLOAD_APP_BUCKET || '').trim();
    const key = String(process.env.DOWNLOAD_APP_KEY || 'Enacle-app.exe').trim();

    if (!s3Bucket) {
      return res.status(500).json({
        message: 'S3 not configured',
      });
    }

    const bucket = downloadBucketOverride || s3Bucket;

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);

    if (!response?.Body) {
      return res.status(404).json({ message: 'File not found on S3' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="Enacle-app.exe"');
    res.setHeader('Cache-Control', 'no-store');

    if (response.ContentLength !== undefined && response.ContentLength !== null) {
      res.setHeader('Content-Length', String(response.ContentLength));
    }

    response.Body.on('error', (err) => {
      console.error('S3 stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Failed to stream file' });
      }
    });

    return response.Body.pipe(res);
  } catch (err) {
    console.error('Download error:', err);
    const code = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
    const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
    if (code === 'NoSuchKey' || /NoSuchKey/i.test(msg)) {
      return res.status(404).json({ message: 'File not found on S3' });
    }
    if (code === 'AccessDenied' || /AccessDenied/i.test(msg)) {
      return res.status(403).json({ message: 'Access denied to S3 object (check bucket policy/IAM credentials)' });
    }
    return res.status(500).json({ message: 'Failed to download file' });
  }
});

// GET /api/download/:s3_key - Stream a PDF from S3 by key (stable key, no signed URL)
router.get('/:s3Key(*)', authMiddleware, async (req, res, next) => {
  try {
    const raw = typeof req.params?.s3Key === 'string' ? req.params.s3Key : '';
    const key = decodeURIComponent(raw).trim();

    if (!key) {
      return res.status(400).json({ message: 's3_key is required' });
    }

    // Admin-only endpoint for generated outputs.
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const allowedPrefix = 'documents/final/';
    if (!key.startsWith(allowedPrefix)) {
      return res.status(403).json({ message: 'Not authorized to access this key' });
    }

    const bucket = String(process.env.S3_BUCKET || '').trim();
    if (!bucket) {
      return res.status(500).json({ message: 'S3 not configured' });
    }

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj = await s3.send(command);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="output.pdf"');
    res.setHeader('Cache-Control', 'no-store');

    if (!obj?.Body) {
      return res.status(404).json({ message: 'File not found' });
    }

    obj.Body.on('error', () => {
      try {
        res.end();
      } catch {
        // ignore
      }
    });

    return obj.Body.pipe(res);
  } catch (err) {
    return next(err);
  }
});

export default router;
