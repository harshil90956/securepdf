import express from 'express';
import { downloadFromS3 } from '../services/s3.js';
import VectorDocumentAccess from '../vectorModels/VectorDocumentAccess.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

function parseSvgRootMeta(svgText) {
  const m = svgText.match(/<svg\b[^>]*>/i);
  if (!m) {
    throw new Error('Invalid SVG: missing <svg> root');
  }
  const openTag = m[0];

  const vb = openTag.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
  let origW = null;
  let origH = null;
  if (vb) {
    const parts = vb[2].trim().split(/[\s,]+/).map((v) => Number(v));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      origW = parts[2];
      origH = parts[3];
    }
  }

  if (origW === null || origH === null) {
    const w = openTag.match(/\bwidth\s*=\s*(["'])([^"']+)\1/i);
    const h = openTag.match(/\bheight\s*=\s*(["'])([^"']+)\1/i);
    const wNum = w ? Number(String(w[2]).trim().replace(/[^0-9.+-eE]/g, '')) : NaN;
    const hNum = h ? Number(String(h[2]).trim().replace(/[^0-9.+-eE]/g, '')) : NaN;
    if (Number.isFinite(wNum) && Number.isFinite(hNum) && wNum > 0 && hNum > 0) {
      origW = wNum;
      origH = hNum;
    }
  }

  if (!(Number.isFinite(origW) && Number.isFinite(origH) && origW > 0 && origH > 0)) {
    throw new Error('Invalid SVG: cannot determine source dimensions (needs viewBox or width/height)');
  }

  return { openTag, origW, origH };
}

function buildNormalizedSvg(svgText, wMm, hMm) {
  const { openTag, origW, origH } = parseSvgRootMeta(svgText);
  const closeIdx = svgText.toLowerCase().lastIndexOf('</svg>');
  if (closeIdx === -1) {
    throw new Error('Invalid SVG: missing </svg>');
  }

  const afterOpenIdx = svgText.indexOf(openTag) + openTag.length;
  const inner = svgText.slice(afterOpenIdx, closeIdx);

  const scaleX = wMm / origW;
  const scaleY = hMm / origH;

  const normalizedOpen = openTag
    .replace(/\bviewBox\s*=\s*(["']).*?\1/gi, '')
    .replace(/\bwidth\s*=\s*(["']).*?\1/gi, '')
    .replace(/\bheight\s*=\s*(["']).*?\1/gi, '')
    .replace(/\spreserveAspectRatio\s*=\s*(["']).*?\1/gi, '')
    .replace(/\s+>/, '>')
    .replace(/>\s*$/, ` viewBox="0 0 ${wMm} ${hMm}" width="${wMm}mm" height="${hMm}mm">`);

  const wrapped = `<g transform="scale(${scaleX} ${scaleY})">${inner}</g>`;
  return `${normalizedOpen}${wrapped}</svg>`;
}

router.post('/normalize-svg', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const svg_s3_key = typeof body.svg_s3_key === 'string' ? body.svg_s3_key.trim() : '';
    const object_mm = body.object_mm && typeof body.object_mm === 'object' ? body.object_mm : null;

    const wMm = object_mm && Number(object_mm.w);
    const hMm = object_mm && Number(object_mm.h);

    if (!svg_s3_key) {
      return res.status(400).json({ message: 'svg_s3_key is required' });
    }
    if (!(Number.isFinite(wMm) && wMm > 0 && Number.isFinite(hMm) && hMm > 0)) {
      return res.status(400).json({ message: 'object_mm.w and object_mm.h are required and must be > 0' });
    }

    const authHeader = String(req.headers.authorization || '');
    const hasBearer = authHeader.startsWith('Bearer ');
    if (hasBearer) {
      await new Promise((resolve) => authMiddleware(req, res, resolve));
      if (res.headersSent) return;
      requireAdmin(req, res, () => null);
      if (res.headersSent) return;
    } else {
      const sessionToken = String(req.headers['x-session-token'] || '').trim();
      if (!sessionToken) {
        return res.status(401).json({ logout: true, message: 'Unauthorized' });
      }

      const m = svg_s3_key.match(/^documents\/raw\/([^/]+)\.svg$/i);
      const documentId = m && m[1] ? String(m[1]).trim() : '';
      if (!documentId) {
        return res.status(400).json({ message: 'svg_s3_key must be documents/raw/<documentId>.svg for session access' });
      }

      const access = await VectorDocumentAccess.findOne({ documentId, sessionToken, revoked: false })
        .populate({ path: 'documentId', model: 'VectorDocument' })
        .exec();
      if (!access) {
        return res.status(404).json({ message: 'Access not found' });
      }
    }

    const raw = await downloadFromS3(svg_s3_key);
    const svgText = raw.toString('utf8');

    const normalized_svg = buildNormalizedSvg(svgText, wMm, hMm);

    return res.status(200).json({
      normalized_svg,
      object_mm: { w: wMm, h: hMm },
      coordinate_space: 'mm',
    });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'normalize-svg failed' });
  }
});

export default router;
