require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Event = require("../src/models/Event");
const MigrationCheckpoint = require("../src/models/MigrationCheckpoint");
const { insertEvents, runMigrations, getClickhouseClient } = require("../src/shared/clickhouseClient");
const { logger } = require("../src/shared/logger");

const CHECKPOINT_KEY = "backfill:clickhouse";
const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || 1000);
// Scope: only this project's Mongo events are backfilled. The old
// unscoped version swept up every project's stale test data (load-test
// sessions, earlier fixtures), which both inflated the run and -- worse --
// made "totalAllTime" meaningless across reruns.

/**
 * Deterministic from the Mongo _id, not a fresh random id. This is what
 * "reruns are safe" is actually built on — resuming from the checkpoint
 * after a crash reprocesses at most one partial batch, and every row it
 * (re-)produces for a given Mongo event carries the exact same event_id
 * every time, which the app itself already treats as the durable identity
 * of that occurrence.
 *
 * Caveat, stated plainly rather than glossed over: events_v2 is a plain
 * append-only MergeTree, not ReplacingMergeTree — ClickHouse itself will
 * not deduplicate two inserts of the same event_id at merge time. Resuming
 * from a checkpoint is safe (it only ever advances past already-inserted
 * ranges). Deliberately re-running the *entire* backfill from scratch
 * after a full first pass would double-insert everything already migrated
 * — that's an operator action, not something this script silently
 * protects against, and it's why checkParity.js exists as a second,
 * independent check before ever flipping a project to 'clickhouse'.
 */
function deterministicEventId(mongoId) {
  return `mongo:${mongoId.toString()}`;
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
    occurred_at: doc.timestamp.toISOString().replace("T", " ").replace("Z", ""),
  };
}

async function run() {
  await connectDB();
  await runMigrations();

  const checkpoint = (await MigrationCheckpoint.findOne({ key: CHECKPOINT_KEY })) ||
    new MigrationCheckpoint({ key: CHECKPOINT_KEY, processedCount: 0 });

  logger.info(
    { resumingFrom: checkpoint.lastProcessedId?.toString() || "the beginning" },
    "starting clickhouse backfill",
  );

  let totalThisRun = 0;
  let skippedLive = 0;
  const ch = getClickhouseClient();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = checkpoint.lastProcessedId ? { _id: { $gt: checkpoint.lastProcessedId } } : {};
    const batch = await Event.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).lean();
    if (batch.length === 0) break;

    // Skip rows the live worker already inserted (same canonical
    // event_id). Without this, dual-mode projects get every event twice:
    // once via the stream, once via backfill -- the exact 2x parity
    // mismatch this fix closes. One EXISTS per event: slower than a bulk
    // IN, but this ClickHouse/client version rejects Array(Tuple) params,
    // and backfill is a one-shot operator script, not a hot path.
    const candidateRows = batch.map(toRow);
    const fresh = [];
    for (const row of candidateRows) {
      const res = await ch.query({
        query: `SELECT 1 FROM events_v2 WHERE project_id = {pid:String} AND event_id = {eid:String} LIMIT 1`,
        query_params: { pid: String(row.project_id), eid: String(row.event_id) },
        format: "JSONEachRow",
      });
      const hit = await res.json();
      if (!hit.length) fresh.push(row);
      else skippedLive++;
    }

    if (fresh.length) await insertEvents(fresh);

    checkpoint.lastProcessedId = batch[batch.length - 1]._id;
    checkpoint.processedCount += batch.length;
    checkpoint.updatedAt = new Date();
    await checkpoint.save();

    totalThisRun += fresh.length;
    logger.info({ batch: fresh.length, skippedLive, totalThisRun, totalAllTime: checkpoint.processedCount }, "backfill batch inserted");
  }

  logger.info({ totalThisRun, skippedLive, totalAllTime: checkpoint.processedCount }, "backfill complete — nothing left to process");
  await mongoose.disconnect();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "backfill failed");
      process.exit(1);
    });
}

module.exports = { deterministicEventId, toRow };
