const { ingestBatch } = require("../shared/ingestPipeline");

/**
 * POST /api/events/ingest — the V1 shape (single event, snake_case-or-
 * camelCase tolerant body) kept working for any SDK build still using it.
 * Internally this is just a one-event call into the exact same pipeline
 * `/api/v2/collect` uses — there's no separate, silently-diverging V1
 * ingestion implementation to keep in sync by hand.
 */
const ingestEvent = async (req, res) => {
  const body = req.body || {};

  const normalized = {
    sessionId: body.sessionId || body.session_id,
    userId: body.userId || body.user_id,
    eventType: body.eventType || body.event_type || body.type,
    url: body.url || body?.metadata?.url,
    element: body.element || body?.metadata?.element || null,
    occurredAt: body.timestamp || body.occurredAt || body?.metadata?.timestamp,
    properties: body.metadata || body.properties || {},
    consent: body.consent, // absent -> "n/a", the V1 pre-consent-model default
  };

  if (!normalized.sessionId || !normalized.eventType || !normalized.url) {
    return res.status(400).json({ message: "sessionId, eventType, and url are required fields" });
  }

  try {
    const result = await ingestBatch({ project: req.project, rawEvents: [normalized], req });

    if (result.accepted === 0) {
      const reason = result.errors[0]?.error || "Event was not accepted";
      return res.status(400).json({ message: reason });
    }

    return res.status(201).json({
      message: "Event ingested successfully",
      event: { ...normalized, projectId: req.project._id },
    });
  } catch (error) {
    return res.status(500).json({ message: "Event ingestion failed", error: error.message });
  }
};

module.exports = { ingestEvent };