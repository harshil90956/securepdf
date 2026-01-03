export const tracePrefix = ({ traceId, jobId }) => {
  const t = typeof traceId === 'string' && traceId.trim() ? traceId.trim() : 'unknown';
  const j = typeof jobId === 'string' && jobId.trim() ? jobId.trim() : String(jobId || 'unknown');
  return `[TRACE:${t}] [JOB:${j}]`;
};

export const traceLog = ({ traceId, jobId, event, payload }) => {
  console.log(`${tracePrefix({ traceId, jobId })} ${String(event || 'EVENT')}`, payload || {});
};

export const traceWarn = ({ traceId, jobId, event, payload }) => {
  console.warn(`${tracePrefix({ traceId, jobId })} ${String(event || 'EVENT')}`, payload || {});
};

export const traceError = ({ traceId, jobId, event, payload }) => {
  console.error(`${tracePrefix({ traceId, jobId })} ${String(event || 'EVENT')}`, payload || {});
};
