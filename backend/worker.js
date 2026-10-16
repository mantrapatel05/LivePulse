require("dotenv").config();
const os = require("os");
const { createRedisClient } = require("./src/shared/redisClient");
const { readBatch, reclaimStale, ack, pendingCount } = require("./src/shared/redisStream");
const { insertEvents, runMigrations } = require("./src/shared/clickhouseClient");
const { claimClickhouseInsert, releaseClickhouseInsertClaim } = require("./src/shared/idempotency");
const { logger, withCorrelation } = require("./src/shared/logger");
let workerBatchSize = { observe: () => {} };
let streamLag = { set: () => {} };
try {
  ({ workerBatchSize, streamLag } = require("./src/shared/metrics"));
} catch {}

const CONSUMER_NAME = `${os.hostname()}-${process.pid}`;
const RECLAIM_IDLE_MS = Number(process.env.WORKER_RECLAIM_IDLE_MS || 30000);
const READ_COUNT = Number(process.env.WORKER_BATCH_COUNT || 500);
const READ_BLOCK_MS = Number(process.env.WORKER_BLOCK_MS || 1000);

let shuttingDown = false;

function toClickhouseRow(entry) {
  const e = entry.event;
  return {
    project_id: entry.projectId,
    // Canonical event_id: mongo:<ObjectId> on both live + backfill paths.
    // dual-mode events carry mongoEventId from the pipeline (Mongo was
    // written first, so the _id exists). clickhouse-mode projects skip
    // Mongo entirely, so fall back to the V2 eventId namespaced as live:.
    // Either way the SAME logical event always maps to the SAME event_id,
    // which is what makes live-vs-backfill dedupe converge.
    event_id: e.mongoEventId || `live:${e.eventId}`,
    session_id: e.sessionId,
    user_id: e.userId || "anonymous",
    event_type: e.eventType,
    url: e.url,
    element: e.element ?? null,
    consent: e.consent || "n/a",
    country: e.country || "",
    city: e.city ?? null,
    device_type: e.deviceType || "",
    browser: e.browser || "",
    properties: JSON.stringify(e.properties ?? {}),
    client_context: JSON.stringify(e.clientContext ?? {}),
    occurred_at: toClickhouseDateTime(e.occurredAt),
  };
}

// @clickhouse/client with JSONEachRow expects "YYYY-MM-DD HH:MM:SS.mmm", not a JS Date/ISO string with a "T"/"Z".
function toClickhouseDateTime(value) {
  const d = new Date(value);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

async function processBatch(entries, redis, log = logger) {
  if (!entries.length) return;
  workerBatchSize.observe(entries.length);

  const badIds = entries.filter((e) => !e.event).map((e) => e.id);
  const validEntries = entries.filter((e) => e.event);

  // Claims in parallel, keyed on the CANONICAL event_id (same value
  // toClickhouseRow writes) so live/backfill/retries converge instead of
  // claiming one key and inserting under another.
  const claims = await Promise.all(
    validEntries.map((e) => {
      const row = toClickhouseRow(e);
      e._canonicalId = row.event_id;
      return claimClickhouseInsert(redis, e.projectId, row.event_id);
    }),
  );
  const toInsert = validEntries.filter((_, i) => claims[i]);
  const claimed = toInsert;

  const rows = toInsert.map(toClickhouseRow);

  if (rows.length) {
    try {
      await insertEvents(rows);
    } catch (err) {
      // Roll back, or the retry would skip these as "already inserted" and lose them.
      // Release by canonical event_id (same key claimed above), not the raw SDK id.
      await Promise.all(
        claimed.map((e) =>
          releaseClickhouseInsertClaim(redis, e.projectId, e._canonicalId || `live:${e.event.eventId}`),
        ),
      );
      throw err;
    }
  }

  // Malformed payloads (shouldn't happen — the API validates before
  // publishing — but a poisoned stream entry from a bug elsewhere must
  // not wedge the consumer group forever) are ACKed off immediately
  // rather than retried, since retrying won't make invalid JSON valid.
  await ack(redis, [...entries.map((e) => e.id)]);

  if (log && log.info) {
    log.info(
      {
        inserted: rows.length,
        malformedSkipped: badIds.length,
        duplicatesSkipped: validEntries.length - toInsert.length,
      },
      "batch processed",
    );
  }
}

async function loop(redis) {
  const log = logger.child({ consumer: CONSUMER_NAME });
  while (!shuttingDown) {
    try {
      const fresh = await readBatch(redis, CONSUMER_NAME, { count: READ_COUNT, blockMs: READ_BLOCK_MS });
      if (fresh.length) {
        const correlationId = fresh[0]?.correlationId;
        await processBatch(fresh, redis, correlationId ? withCorrelation(correlationId) : log);
        continue; // immediately check for more — don't wait out the reclaim pass while busy
      }

      const reclaimed = await reclaimStale(redis, CONSUMER_NAME, { minIdleMs: RECLAIM_IDLE_MS });
      if (reclaimed.length) {
        await processBatch(reclaimed, redis, log);
      }

      const pending = await pendingCount(redis);
      streamLag.set(pending);
    } catch (err) {
      log.error({ err }, "worker loop iteration failed — backing off");
      await sleep(1000);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.info({ consumer: CONSUMER_NAME }, "worker starting");
  // Deliberately no Mongo connection here: the worker only moves data
  // from events:v2 to ClickHouse. Dual-writing to Mongo happens on the
  // API side (ingestPipeline.js) -- coupling the worker to Mongo would
  // mean a Mongo outage takes ClickHouse ingestion down too, for no
  // functional reason.

  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err: err.message }, "clickhouse migrations failed to apply — worker will still try to run, inserts may fail until this is fixed");
  }

  const redis = createRedisClient("worker");
  await loop(redis);
}

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, finishing current batch then exiting");
  shuttingDown = true;
});
process.on("SIGINT", () => {
  shuttingDown = true;
});

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, "worker crashed");
    process.exit(1);
  });
}

module.exports = { toClickhouseRow, toClickhouseDateTime, processBatch };
