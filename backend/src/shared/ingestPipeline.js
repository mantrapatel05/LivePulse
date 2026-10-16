const crypto = require("crypto");
const Event = require("../models/Event");
const Session = require("../models/Session");
const { validateEvent } = require("./eventSchema");
const { publishEvent, queuePublish } = require("./redisStream");
const { touchSession, queueSessionTouches } = require("./activeSessionState");
const { claimEventId, claimEventIds, releaseEventId, releaseEventIds } = require("./idempotency");
const { getRedisClient } = require("./redisClient");
const { getClientIp, resolveGeo } = require("../services/geo");
const { parseUserAgent } = require("../services/userAgent");
let eventsAccepted = { inc: () => {} };
let eventsRejected = { inc: () => {} };
let ingestStage = { startTimer: () => () => {} };
try {
  ({ eventsAccepted, eventsRejected, ingestStage } = require("./metrics"));
} catch {}
const { logger } = require("./logger");

function summary(accepted, rejected, duplicates, correlationId, internalFailures = 0) {
  return { accepted, rejected: rejected.length, duplicates, errors: rejected, correlationId, internalFailures };
}

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
/**
 * Redis cost per batch: 2 round trips (claim all, then publish+touch all),
 * not 3 per event. Single-event batches keep the old sequential path --
 * pipelines have fixed setup cost that hurts at N=1.
 *
 * Canonical ordering (parity contract): Mongo FIRST, then the stream.
 */
async function ingestBatch({ project, rawEvents, req }) {
  const redis = getRedisClient();
  const io = req.app.get("io");
  const correlationId = req.id || crypto.randomUUID();
  const projectId = String(project._id);
  const geo = resolveGeo(getClientIp(req));
  const ua = parseUserAgent(req.headers["user-agent"]);

  const rejected = [];
  const valid = [];
  rawEvents.forEach((raw, index) => {
    const result = validateEvent(raw, index);
    if (result.ok) valid.push({ index, event: result.event });
    else {
      rejected.push({ index, error: result.error });
      eventsRejected.inc({ reason: "validation" });
    }
  });
  if (!valid.length) return summary(0, rejected, 0, correlationId);

  if (valid.length === 1) {
    return ingestSingle({ project, projectId, item: valid[0], rejected, req, io, correlationId, geo, ua, redis });
  }

  // Redis round trip 1: claim every eventId at once
  let end = ingestStage.startTimer({ stage: "claim" });
  let claims;
  try {
    claims = await claimEventIds(redis, projectId, valid.map((v) => v.event.eventId));
  } finally {
    end();
  }

  const fresh = valid
    .filter((_, i) => claims[i])
    .map(({ index, event }) => ({
      index,
      event: { ...event, country: geo.country, city: geo.city, deviceType: ua.deviceType, browser: ua.browser },
    }));
  const duplicates = valid.length - fresh.length;
  if (!fresh.length) return summary(0, rejected, duplicates, correlationId);

  // Mongo FIRST (canonical _ids for the parity contract), then the stream.
  if (project.analyticsBackend !== "clickhouse") {
    end = ingestStage.startTimer({ stage: "mongo" });
    try {
      const mongoByIndex = await dualWriteMongoBatch({ project, items: fresh, io });
      fresh.forEach(({ index, event }) => {
        event.mongoEventId = `mongo:${String(mongoByIndex.get(index)._id)}`;
      });
    } catch (err) {
      logger.error({ err, correlationId }, "mongo batch write failed before stream publish");
      await releaseEventIds(redis, projectId, fresh.map((f) => f.event.eventId)).catch(() => {});
      fresh.forEach(({ index }) => {
        rejected.push({ index, error: "internal error accepting event" });
        eventsRejected.inc({ reason: "internal" });
      });
      return summary(0, rejected, duplicates, correlationId, fresh.length);
    } finally {
      end();
    }
  }

  // Redis round trip 2: every XADD + one touch per distinct session
  const pipeline = redis.pipeline();
  fresh.forEach(({ event }) => queuePublish(pipeline, { projectId, event, correlationId }));
  queueSessionTouches(pipeline, projectId, fresh.map((f) => f.event));

  end = ingestStage.startTimer({ stage: "publish" });
  let results;
  try {
    results = await pipeline.exec();
  } catch (err) {
    await releaseEventIds(redis, projectId, fresh.map((f) => f.event.eventId)).catch(() => {});
    throw err;
  } finally {
    end();
  }

  const published = [];
  const failedIds = [];
  fresh.forEach((item, i) => {
    if (results[i][0]) {
      failedIds.push(item.event.eventId);
      rejected.push({ index: item.index, error: "internal error accepting event" });
      eventsRejected.inc({ reason: "internal" });
    } else {
      published.push(item);
    }
  });
  if (failedIds.length) await releaseEventIds(redis, projectId, failedIds).catch(() => {});
  if (!published.length) return summary(0, rejected, duplicates, correlationId, failedIds.length);

  published.forEach(({ event }) => emitLive(io, project._id, event));

  eventsAccepted.inc({ project_id: projectId }, published.length);
  return summary(published.length, rejected, duplicates, correlationId, failedIds.length);
}

/** Single-event fast path: pipelines cost more than they save at N=1. */
async function ingestSingle({ project, projectId, item, rejected, io, correlationId, geo, ua, redis }) {
  const { index, event } = item;
  const isNew = await claimEventId(redis, projectId, event.eventId);
  if (!isNew) return summary(0, rejected, 1, correlationId);

  const enriched = { ...event, country: geo.country, city: geo.city, deviceType: ua.deviceType, browser: ua.browser };

  try {
    if (project.analyticsBackend !== "clickhouse") {
      const written = await dualWriteMongo({ project, event: enriched, io });
      enriched.mongoEventId = `mongo:${String(written.event._id)}`;
    }
    await publishEvent(redis, { projectId, event: enriched, correlationId });
    await touchSession(redis, { projectId, sessionId: event.sessionId, url: event.url, userId: event.userId });
    emitLive(io, project._id, enriched);
    eventsAccepted.inc({ project_id: projectId });
    return summary(1, rejected, 0, correlationId);
  } catch (err) {
    await releaseEventId(redis, projectId, event.eventId).catch(() => {});
    logger.error({ err, eventId: event.eventId, correlationId }, "failed to ingest event");
    rejected.push({ index, error: "internal error accepting event" });
    eventsRejected.inc({ reason: "internal" });
    return summary(0, rejected, 0, correlationId, 1);
  }
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
 * Batched dual-write: 1 insertMany + 1 upsert per distinct session, not
 * 2 writes per event. Session merge preserves per-event semantics: count
 * sums, last-wins fields come from the latest occurredAt, startedAt from
 * the earliest (matches the old $setOnInsert behaviour on first insert).
 * Returns Map<batchIndex, EventDoc> for canonical _id stamping.
 */
async function dualWriteMongoBatch({ project, items, io }) {
  const docs = await Event.insertMany(
    items.map(({ event: e }) => ({
      projectId: project._id,
      sessionId: e.sessionId,
      userId: e.userId,
      eventType: e.eventType,
      url: e.url,
      element: e.element,
      timestamp: e.occurredAt,
      metadata: e.properties,
      city: e.city,
    })),
    { ordered: false },
  );

  const byIndex = new Map();
  docs.forEach((doc, i) => byIndex.set(items[i].index, doc));

  const bySession = new Map();
  for (const { event: e } of items) {
    const s = bySession.get(e.sessionId) || { count: 0, first: e, last: e };
    s.count++;
    if (e.occurredAt < s.first.occurredAt) s.first = e;
    if (e.occurredAt >= s.last.occurredAt) s.last = e;
    bySession.set(e.sessionId, s);
  }

  const sessions = await Promise.all(
    [...bySession.entries()].map(([sessionId, s]) =>
      Session.findOneAndUpdate(
        { projectId: project._id, sessionId },
        {
          $set: {
            userId: s.last.userId,
            lastSeenAt: s.last.occurredAt,
            currentUrl: s.last.url,
            lastEventType: s.last.eventType,
            city: s.last.city,
          },
          $setOnInsert: { startedAt: s.first.occurredAt },
          $inc: { eventCount: s.count },
        },
        { upsert: true, returnDocument: "after" },
      ),
    ),
  );

  if (io) {
    const room = `project:${project._id}`;
    for (const session of sessions) {
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
  }

  return byIndex;
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
