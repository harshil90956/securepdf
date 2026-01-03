import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { listPrintEngineFonts } from '../services/printEngineClient.js';

const router = express.Router();

router.get('/fonts', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const traceId = typeof req.headers['x-trace-id'] === 'string' ? String(req.headers['x-trace-id']).trim() : '';
    const fonts = await listPrintEngineFonts({ traceId: traceId || undefined });
    return res.json(Array.isArray(fonts) ? fonts : []);
  } catch (err) {
    const statusCode = Number(err?.statusCode || err?.status || 0);
    const msg = String(err?.message || '').trim();
    return res.status(statusCode >= 400 ? statusCode : 500).json({ message: msg || 'Failed to list fonts' });
  }
});

export default router;
