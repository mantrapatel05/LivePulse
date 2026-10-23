require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Event = require("../src/models/Event");
const MigrationCheckpoint = require("../src/models/MigrationCheckpoint");
const { insertEvents, runMigrations, getClickhouseClient } = require("../src/shared/clickhouseClient");
const { createRedisClient } = require("../src/shared/redisClient");
const { claimClickhouseInsert, releaseClickhouseInsertClaim } = require("../src/shared/idempotency");
const { logger } = require("../src/shared/logger");

const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || 1000);

function checkpointKey(projectId) {
  return `backfill:clickhouse:${String(projectId)}`;
}

function backfillQuery(projectId, lastProcessedId) {
  const query = { projectId };
  if (lastProcessedId) query._id = { $gt: lastProcessedId };
  return query;
}

/**
 * Deterministic from the Mongo _id, not a fresh random id. The batched
 * existence check and the live worker's Redis claim both use this durable
 * event identity, making full reruns and concurrent ingestion safe.
 */
function deterministicEventId(mongoId) {
  return `mongo:${mongoId.toString()}`;
}

function toChTime(d) {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function toRow(doc) {
  return {
    project_id: String(doc.projectId),
    event_id: deterministicEventId(doc._id),
    session_id: doc.sessionId,
    user_id: doc.userId || "anonymous",
    event_type: doc.eventType,
    url: doc.url,
    element: doc.element ?? null,
    consent: "n/a", // pre-consent-model V1 data
    country: "",
    city: doc.city ?? null,
    device_type: "",
    browser: "",
    properties: JSON.stringify(doc.metadata ?? {}),
    client_context: "{}",
    occurred_at: toChTime(doc.timestamp),
  };
}

async function existingEventIds(ch, rows) {
  const times = rows.map((r) => Date.parse(r.occurred_at.replace(" ", "T") + "Z"));
  const res = await ch.query({
    query: `SELECT event_id FROM events_v2
            WHERE project_id IN {pids:Array(String)}
              AND occurred_at >= {minT:DateTime64(3)} AND occurred_at <= {maxT:DateTime64(3)}
              AND event_id IN {ids:Array(String)}`,
    query_params: {
      pids: [...new Set(rows.map((r) => r.project_id))],
      minT: toChTime(new Date(Math.min(...times) - 1000)),
      maxT: toChTime(new Date(Math.max(...times) + 1000)),
      ids: rows.map((r) => r.event_id),
    },
    format: "JSONEachRow",
  });
  return new Set((await res.json()).map((r) => r.event_id));
}

async function run() {
  const projectId = process.argv[2];
  if (!mongoose.isValidObjectId(projectId)) {
    throw new Error("Usage: node scripts/backfillClickhouse.js <projectId>");
  }

  await connectDB();
  await runMigrations();

  const key = checkpointKey(projectId);
  const checkpoint = (await MigrationCheckpoint.findOne({ key })) ||
    new MigrationCheckpoint({ key, processedCount: 0 });

  logger.info(
    { resumingFrom: checkpoint.lastProcessedId?.toString() || "the beginning" },
    "starting clickhouse backfill",
  );

  let totalThisRun = 0;
  let skipped = 0;
  const ch = getClickhouseClient();
  const redis = createRedisClient("backfill");

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const query = backfillQuery(projectId, checkpoint.lastProcessedId);
      const batch = await Event.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).lean();
      if (batch.length === 0) break;

      const candidates = batch.map(toRow);
      const present = await existingEventIds(ch, candidates);
      const notInCh = candidates.filter((r) => !present.has(r.event_id));
      skipped += candidates.length - notInCh.length;
      const claims = await Promise.all(
        notInCh.map((r) => claimClickhouseInsert(redis, r.project_id, r.event_id)),
      );
      const fresh = notInCh.filter((_, i) => claims[i]);
      skipped += notInCh.length - fresh.length;

      if (fresh.length) {
        try {
          await insertEvents(fresh);
        } catch (err) {
          await Promise.all(
            fresh.map((r) => releaseClickhouseInsertClaim(redis, r.project_id, r.event_id)),
          );
          throw err;
        }
      }

      checkpoint.lastProcessedId = batch[batch.length - 1]._id;
      checkpoint.processedCount += batch.length;
      checkpoint.updatedAt = new Date();
      await checkpoint.save();

      totalThisRun += fresh.length;
      logger.info(
        {
          inserted: fresh.length,
          skipped: candidates.length - fresh.length,
          totalThisRun,
          totalAllTime: checkpoint.processedCount,
        },
        "backfill batch processed",
      );
    }

    logger.info(
      { inserted: totalThisRun, skipped, totalAllTime: checkpoint.processedCount },
      "backfill complete - nothing left to process",
    );
  } finally {
    await redis.quit();
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "backfill failed");
      process.exit(1);
    });
}

module.exports = { deterministicEventId, toRow, existingEventIds, checkpointKey, backfillQuery };
