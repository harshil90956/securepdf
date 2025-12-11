const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

const app = express();
const upload = multer();

function getPageSizeFromViewBox(svgText) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!viewBoxMatch) return null;

  const parts = viewBoxMatch[1]
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));

  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return null;

  // Interpret viewBox units as points; this keeps vector and aspect ratio correct.
  return [width, height];
}

app.post('/svg-to-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Missing SVG file');
    }

    const svgText = req.file.buffer.toString('utf8');

    const pageSize = getPageSizeFromViewBox(svgText) || 'A4';

    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.send(pdfBuffer);
    });

    doc.addPage({ size: pageSize });

    // Draw the SVG as vector operations, not as a raster image.
    SVGtoPDF(doc, svgText, 0, 0, {
      preserveAspectRatio: 'xMidYMid meet',
      assumePt: true,
    });

    doc.end();
  } catch (err) {
    console.error('SVG-to-PDF error:', err);
    res.status(500).send('Conversion failed');
  }
});

// Diagnostic endpoint: returns a simple vector PDF generated from an inline SVG
// so you can verify that the service is producing vector output.
app.get('/diagnostic/vector-test', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect x="10" y="10" width="180" height="180" fill="#1e90ff" stroke="#000" stroke-width="4"/>
  <circle cx="100" cy="100" r="60" fill="#fff" stroke="#000" stroke-width="3"/>
  <text x="100" y="110" font-size="24" text-anchor="middle" fill="#000">Vector</text>
</svg>`;

  const pageSize = getPageSizeFromViewBox(svg) || 'A4';
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  });

  doc.addPage({ size: pageSize });

  SVGtoPDF(doc, svg, 0, 0, {
    preserveAspectRatio: 'xMidYMid meet',
    assumePt: true,
  });

  doc.end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SVG-to-PDF vector service listening on port ${port}`);
});
