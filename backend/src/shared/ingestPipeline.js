const crypto = require("crypto");
const Event = require("../models/Event");
const Session = require("../models/Session");
const { validateEvent } = require("./eventSchema");
const { publishEvent } = require("./redisStream");
const { touchSession } = require("./activeSessionState");
const { claimEventId } = require("./idempotency");
const { getRedisClient } = require("./redisClient");
const { getClientIp, resolveGeo } = require("../services/geo");
const { parseUserAgent } = require("../services/userAgent");
let eventsAccepted = { inc: () => {} };
let eventsRejected = { inc: () => {} };
try {
  ({ eventsAccepted, eventsRejected } = require("./metrics"));
} catch {}
const { logger } = require("./logger");

/**
 * Accepts a batch of *raw* (unvalidated) event bodies for one project and
 * runs the whole V2 path: validate -> dedupe -> enrich -> durable Redis
 * Stream buffer -> live-now state -> Socket.IO fan-out -> (conditionally)
 * Mongo dual-write. This is the single code path both `/api/events/ingest`
 * (V1 shape, one event) and `/api/v2/collect` (batch envelope) funnel
 * through — there is deliberately no separate, divergent V1 ingestion
 * implementation left anywhere.
 *
 * Never waits on ClickHouse — publishEvent() only waits on Redis (XADD),
 * which is what makes the "collector acknowledgement p95 under 200ms"
 * target realistic regardless of ClickHouse load.
 */
async function ingestBatch({ project, rawEvents, req }) {
  const redis = getRedisClient();
  const io = req.app.get("io");
  const correlationId = req.id || crypto.randomUUID();
  const geo = resolveGeo(getClientIp(req));
  const ua = parseUserAgent(req.headers["user-agent"]);

  const rejected = [];
  let acceptedCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < rawEvents.length; i++) {
    const result = validateEvent(rawEvents[i], i);
    if (!result.ok) {
      rejected.push({ index: i, error: result.error });
      eventsRejected.inc({ reason: "validation" });
      continue;
    }

    const event = result.event;
    const isNew = await claimEventId(redis, String(project._id), event.eventId);
    if (!isNew) {
      duplicateCount++;
      continue; // already ingested this exact eventId — not an error, just a no-op
    }

    const enriched = {
      ...event,
      country: geo.country,
      city: geo.city,
      deviceType: ua.deviceType,
      browser: ua.browser,
    };

    // Canonical ordering: Mongo FIRST, then the stream.
    // The Mongo _id is the durable identity of this occurrence, and the
    // ClickHouse event_id is derived from it (`mongo:<ObjectId>`) on BOTH
    // the live path (here, via mongoEventId on the enriched payload) and
    // the backfill path (deterministicEventId). Same logical event =>
    // same event_id no matter which path wrote it, so parity holds and
    // dedupe actually converges instead of double-counting.
    try {
      let mongoDoc = null;
      if (project.analyticsBackend !== "clickhouse") {
        const written = await dualWriteMongo({ project, event: enriched, io });
        mongoDoc = written.event;
        enriched.mongoEventId = `mongo:${String(mongoDoc._id)}`;
      }

      await publishEvent(redis, { projectId: String(project._id), event: enriched, correlationId });
      await touchSession(redis, {
        projectId: String(project._id),
        sessionId: event.sessionId,
        url: event.url,
        userId: event.userId,
      });

      emitLive(io, project._id, enriched);

      eventsAccepted.inc({ project_id: String(project._id) });
      acceptedCount++;
    } catch (err) {
      logger.error({ err, eventId: event.eventId, correlationId }, "failed to ingest event");
      rejected.push({ index: i, error: "internal error accepting event" });
      eventsRejected.inc({ reason: "internal" });
    }
  }

  return { accepted: acceptedCount, rejected: rejected.length, duplicates: duplicateCount, errors: rejected, correlationId };
}

/** Canonical V2 event name + the V1 alias, retained only for the migration compatibility window. */
function emitLive(io, projectId, event) {
  if (!io) return;
  const room = `project:${projectId}`;
  const payload = {
    eventId: event.eventId,
    sessionId: event.sessionId,
    userId: event.userId,
    eventType: event.eventType,
    url: event.url,
    element: event.element,
    city: event.city,
    timestamp: event.occurredAt,
  };
  io.to(room).emit("live:event", payload);
  io.to(room).emit("new-event", payload); // V1 alias
}

/**
 * V1-era Mongo writes, preserved during the migration window per
 * analyticsBackend: 'mongo' (V1-only projects) and 'dual' (write both,
 * read Mongo until cutover) both land here. 'clickhouse'-flagged projects
 * skip this entirely — no more Mongo Event documents are created for them.
 */
async function dualWriteMongo({ project, event, io }) {
  const newEvent = await Event.create({
    projectId: project._id,
    sessionId: event.sessionId,
    userId: event.userId,
    eventType: event.eventType,
    url: event.url,
    element: event.element,
    timestamp: event.occurredAt,
    metadata: event.properties,
    city: event.city,
  });

  const session = await Session.findOneAndUpdate(
    { projectId: project._id, sessionId: event.sessionId },
    {
      $set: {
        userId: event.userId,
        lastSeenAt: event.occurredAt,
        currentUrl: event.url,
        lastEventType: event.eventType,
        city: event.city,
      },
      $setOnInsert: { startedAt: event.occurredAt },
      $inc: { eventCount: 1 },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (io) {
    const room = `project:${project._id}`;
    const payload = {
      sessionId: session.sessionId,
      userId: session.userId,
      currentUrl: session.currentUrl,
      lastEventType: session.lastEventType,
      lastSeenAt: session.lastSeenAt,
      eventCount: session.eventCount,
      city: session.city,
    };
    io.to(room).emit("live:session", payload);
    io.to(room).emit("session-updated", payload); // V1 alias
  }

  return { event: newEvent, session };
}

module.exports = { ingestBatch };
