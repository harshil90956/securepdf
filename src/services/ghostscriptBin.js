export function getGhostscriptBin() {
  const bin = process.env.GHOSTSCRIPT_BIN;
  if (!bin || !String(bin).trim()) {
    throw new Error('GHOSTSCRIPT_BIN env is required');
  }
  const resolved = String(bin).trim();
  console.log('[GS_BIN]', resolved);
  return resolved;
}
