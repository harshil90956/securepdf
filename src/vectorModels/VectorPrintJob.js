import mongoose from 'mongoose';

const auditEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    event: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const lifecycleHistorySchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    at: { type: Date, required: true },
    source: { type: String, enum: ['api', 'batch-worker', 'merge-worker', 'normalize-worker'], required: true },
  },
  { _id: false }
);

const printJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    traceId: { type: String, default: null, index: true },

    sourcePdfKey: { type: String, required: true },

    metadata: { type: mongoose.Schema.Types.Mixed, required: true },

    hmacPayload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },

    payloadHmac: { type: String, required: true, immutable: true },

    status: {
      type: String,
      enum: ['CREATED', 'BATCH_RUNNING', 'MERGE_RUNNING', 'READY', 'FAILED'],
      default: 'CREATED',
      index: true,
    },

    readyAt: { type: Date, default: null, index: true },

    batchStartedAt: { type: Date, default: null, index: true },
    batchFinishedAt: { type: Date, default: null, index: true },
    mergeStartedAt: { type: Date, default: null, index: true },
    mergeFinishedAt: { type: Date, default: null, index: true },

    errorAt: { type: Date, default: null, index: true },

    errorCode: { type: String, default: null },

    progress: { type: Number, default: 0 },
    totalPages: { type: Number, default: 1 },

    output: {
      key: { type: String, default: null },
      url: { type: String, default: null },
      expiresAt: { type: Date, default: null, index: true },
    },

    error: {
      message: { type: String, default: null },
      stack: { type: String, default: null },
    },

    audit: { type: [auditEntrySchema], default: [] },

    lifecycleHistory: { type: [lifecycleHistorySchema], default: [] },
  },
  { timestamps: true, collection: 'vector_printjobs' }
);

printJobSchema.virtual('outputKey').get(function outputKeyVirtual() {
  const key = this?.hmacPayload && typeof this.hmacPayload.outputKey === 'string' ? this.hmacPayload.outputKey : null;
  return key ? String(key) : null;
});

const VectorPrintJob = mongoose.models.VectorPrintJob || mongoose.model('VectorPrintJob', printJobSchema);

export default VectorPrintJob;
