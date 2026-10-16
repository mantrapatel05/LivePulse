const { validateEnvelope } = require("../shared/eventSchema");
const { ingestBatch } = require("../shared/ingestPipeline");
const { ValidationError } = require("../shared/errors");

// POST /api/v2/collect — the canonical batch endpoint. Always returns
// accepted/rejected/duplicate counts; never blocks on ClickHouse (see
// ingestPipeline.js — it only awaits the Redis Stream publish).
const collect = async (req, res) => {
  try {
    validateEnvelope(req.body);
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: "Ingestion failed", error: error.message });
  }

  try {
    const result = await ingestBatch({ project: req.project, rawEvents: req.body.events, req });
    if (result.internalFailures > 0) {
      // SDK keeps the batch on non-2xx and retries; idempotency claims
      // make the retry safe for events that already went through.
      return res.status(503).json({
        message: "Some events could not be accepted, retry the batch",
        accepted: result.accepted,
        internalFailures: result.internalFailures,
        correlationId: result.correlationId,
      });
    }
    return res.status(202).json({
      accepted: result.accepted,
      rejected: result.rejected,
      duplicates: result.duplicates,
      correlationId: result.correlationId,
      errors: result.errors.slice(0, 20), // cap payload size on a pathological all-reject batch
    });
  } catch (error) {
    return res.status(500).json({ message: "Ingestion failed", error: error.message });
  }
};

module.exports = { collect };
