import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import VectorPrintJob from '../vectorModels/VectorPrintJob.js';

const router = express.Router();

// Legacy vector job enqueue endpoint is deprecated.
// Backend must act as a proxy to print-engine only.
router.post('/jobs', authMiddleware, requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'Deprecated. Use /api/vector/generate (print-engine proxy)' });
});

router.get('/jobs/:jobId', authMiddleware, requireAdmin, async (req, res) => {
  const jobDoc = await VectorPrintJob.findById(req.params.jobId).exec().catch(() => null);
  if (!jobDoc) return res.status(404).json({ message: 'Job not found' });

  const status = jobDoc.status === 'READY' ? 'DONE' : jobDoc.status;

  return res.json({
    jobId: jobDoc._id,
    status,
    progress: jobDoc.progress,
    totalPages: jobDoc.totalPages,
    createdAt: jobDoc.createdAt,
    updatedAt: jobDoc.updatedAt,
    expiresAt: jobDoc.output?.expiresAt || null,
    error: jobDoc.error?.message || null,
  });
});

router.get('/jobs/:jobId/result', authMiddleware, requireAdmin, async (req, res) => {
  const jobDoc = await VectorPrintJob.findById(req.params.jobId).exec().catch(() => null);
  if (!jobDoc) return res.status(404).json({ message: 'Job not found' });

  if (jobDoc.status !== 'READY' || !jobDoc.output?.key) {
    return res.status(409).json({ message: 'Job not completed' });
  }

  return res.json({ pdf_s3_key: jobDoc.output.key });
});

export default router;
