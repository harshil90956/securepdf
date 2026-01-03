import VectorPrintJob from '../vectorModels/VectorPrintJob.js';

export const runTerminalJobPurgeOnce = async () => {
  const now = new Date();
  const retentionMs = 30 * 24 * 60 * 60 * 1000;
  const retentionBefore = new Date(now.getTime() - retentionMs);

  const delRes = await VectorPrintJob.deleteMany({
    status: { $in: ['READY', 'FAILED'] },
    updatedAt: { $lte: retentionBefore },
  })
    .exec()
    .catch(() => null);

  const removedCount = Number(delRes?.deletedCount || 0);
  console.log('[JOB_CLEANUP]', { removedCount });
};

export const startTerminalJobPurgeLoop = () => {
  const intervalMs = Number(process.env.TERMINAL_JOB_PURGE_INTERVAL_MS || 24 * 60 * 60 * 1000);

  const tick = async () => {
    try {
      await runTerminalJobPurgeOnce();
    } catch {
      // ignore
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
};

export const runJobCleanupOnce = async () => {
  return runTerminalJobPurgeOnce();
};

export const startJobCleanupLoop = () => {
  return startTerminalJobPurgeLoop();
};
