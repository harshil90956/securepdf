import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { uploadToS3WithKey } from '../services/s3.js';

const router = express.Router();
const upload = multer();

router.post('/svg', authMiddleware, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'file is required' });
    }

    const mime = String(file.mimetype || '').toLowerCase();
    const isSvg = mime === 'image/svg+xml' || String(file.originalname || '').toLowerCase().endsWith('.svg');
    if (!isSvg) {
      return res.status(400).json({ message: 'Only SVG files are supported' });
    }

    const key = `documents/overlays/${crypto.randomUUID()}.svg`;
    const uploaded = await uploadToS3WithKey(file.buffer, 'image/svg+xml', key);
    return res.status(201).json({ svg_s3_key: uploaded.key });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'SVG overlay upload failed' });
  }
});

export default router;
