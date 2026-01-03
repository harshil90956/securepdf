export async function renderViaPrintEngine({ job_id, svg_s3_key, object_mm, series, custom_fonts, overlays, render_mode, traceId }) {
  const baseUrl = String(process.env.PRINT_ENGINE_URL || '').trim();
  if (!baseUrl) {
    throw new Error('PRINT_ENGINE_URL not configured');
  }

  const internalKey = String(process.env.PRINT_ENGINE_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '').trim();
  if (!internalKey) {
    throw new Error('PRINT_ENGINE_INTERNAL_KEY not configured');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/generate`;

  const payload = {
    job_id,
    svg_s3_key,
    object_mm,
    series,
    ...(Array.isArray(custom_fonts) ? { custom_fonts } : {}),
    ...(Array.isArray(overlays) ? { overlays } : {}),
    ...(typeof render_mode === 'string' && render_mode.trim() ? { render_mode: render_mode.trim() } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-key': internalKey,
      ...(traceId ? { 'x-trace-id': String(traceId) } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = text || `Print-engine error: ${res.status}`;
    const err = new Error(msg);
    err.statusCode = res.status;
    throw err;
  }

  const data = await res.json();

  return data;
}

export async function listPrintEngineFonts({ traceId } = {}) {
  const baseUrl = String(process.env.PRINT_ENGINE_URL || '').trim();
  if (!baseUrl) {
    throw new Error('PRINT_ENGINE_URL not configured');
  }

  const internalKey = String(process.env.PRINT_ENGINE_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '').trim();
  if (!internalKey) {
    throw new Error('PRINT_ENGINE_INTERNAL_KEY not configured');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/fonts`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-internal-key': internalKey,
      ...(traceId ? { 'x-trace-id': String(traceId) } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = text || `Print-engine error: ${res.status}`;
    const err = new Error(msg);
    err.statusCode = res.status;
    throw err;
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function pingPrintEngineHealth() {
  const baseUrl = String(process.env.PRINT_ENGINE_URL || '').trim();
  if (!baseUrl) {
    throw new Error('PRINT_ENGINE_URL not configured');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`PRINT_ENGINE_URL health check failed: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== true) {
    throw new Error('PRINT_ENGINE_URL health check failed: invalid response');
  }
  return true;
}
