require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Event = require("../src/models/Event");
const Session = require("../src/models/Session");
const MigrationCheckpoint = require("../src/models/MigrationCheckpoint");
const Project = require("../src/models/Project");
const { generateApiKey } = require("../src/shared/apiKeyHash");
const { ingestBatch } = require("../src/shared/ingestPipeline");
const { getRedisClient } = require("../src/shared/redisClient");
const { getClickhouseClient } = require("../src/shared/clickhouseClient");
const { logger } = require("../src/shared/logger");

const FIXTURE_PROJECT_ID = "699d9becf25204ae69676bbb";
const FIXTURE_USER_ID = "local-dev-fixture-user";

// Deterministic on purpose -- rerunning this script against a fresh
// docker-compose stack always produces the exact same data, which is what
// makes it useful for comparing Mongo vs ClickHouse output while working
// on the migration/parity tooling.
//
// Idempotency contract (this is what makes reruns safe):
// 1. Every fixture event carries a FIXED eventId (fixture-000, ...).
//    The ingest pipeline dedupes on (projectId, eventId) via Redis
//    idempotency keys, so re-ingesting the same fixtures is a no-op.
// 2. Before ingesting, we wipe this project's Mongo Events/Sessions,
//    its ClickHouse rows, its idempotency keys, and reset the backfill
//    checkpoint -- so a rerun starts from a known-empty state instead
//    of accumulating duplicates (the old behaviour that broke parity).
const FIXTURE_SESSIONS = ["fixture-session-1", "fixture-session-2", "fixture-session-3"];
const FIXTURE_PAGES = ["/", "/pricing", "/docs", "/blog/launch"];

function fakeRequest(project) {
  return {
    app: { get: () => null }, // no live socket.io instance for a seed script
    headers: { "user-agent": "LivePulseSeedScript/1.0" },
    connection: {},
    socket: {},
    id: "seed-script",
    project,
  };
}

async function resetFixtureState(projectId) {
  // 1. Wipe Mongo state for this project.
  await Event.deleteMany({ projectId });
  await Session.deleteMany({ projectId });
  await MigrationCheckpoint.deleteOne({ key: "backfill:clickhouse" });

  // 2. Wipe ClickHouse rows for this project (async mutation -- wait for it).
  const ch = getClickhouseClient();
  await ch.command({
    query: `ALTER TABLE events_v2 DELETE WHERE project_id = {projectId:String} SETTINGS mutations_sync = 1`,
    query_params: { projectId: String(projectId) },
  });

  // 3. Clear Redis idempotency keys + stale stream entries for a clean slate.
  //    SCAN (not KEYS) so this stays safe on a shared Redis.
  //    NOTE: uses its OWN client (createRedisClient), never getRedisClient() --
  //    the ingest pipeline below shares that singleton, and quit()ing it
  //    would close the pipeline's connection mid-run ("Connection is closed").
  const { createRedisClient } = require("../src/shared/redisClient");
  const redis = createRedisClient("seed-reset");
  for (const pattern of [`idempotency:${projectId}:*`, `idempotency:ch:${projectId}:*`]) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  }
  // Drain already-queued stream entries for THIS project only (other
  // projects' entries are left untouched). XREAD (not XREADGROUP) purely
  // inspects without claiming anything into a pending list, and XDEL
  // removes only our entries. Without this, a rerun would re-deliver the
  // previous run's queued events via the live worker and double-insert
  // them into ClickHouse.
  const { STREAM_KEY } = require("../src/shared/redisStream");
  let lastId = "0";
  for (let i = 0; i < 40; i++) {
    const raw = await redis.xread("COUNT", 500, "STREAMS", STREAM_KEY, lastId);
    const entries = (raw && raw[0] && raw[0][1]) || [];
    if (!entries.length) break;
    const ours = [];
    for (const [id, fields] of entries) {
      lastId = id;
      const obj = {};
      for (let f = 0; f < fields.length; f += 2) obj[fields[f]] = fields[f + 1];
      if (String(obj.projectId) === String(projectId)) ours.push(id);
    }
    if (ours.length) await redis.xdel(STREAM_KEY, ...ours);
    if (entries.length < 500) break;
  }
  await redis.quit();
}

async function run() {
  await connectDB();

  let project = await Project.findById(FIXTURE_PROJECT_ID);
  if (!project) {
    const { prefix, hash } = generateApiKey();
    project = await Project.create({
      _id: new mongoose.Types.ObjectId(FIXTURE_PROJECT_ID),
      name: "LivePulse Fixture Project",
      supabaseUserId: FIXTURE_USER_ID,
      apiKeyPrefix: prefix,
      apiKeyHash: hash,
      analyticsBackend: "dual",
    });
    logger.info({ projectId: project._id }, "created fixture project");
  }

  await resetFixtureState(project._id);

  const rawEvents = [];
  let fixtureSeq = 0;
  const nextFixtureId = () => `fixture-${String(fixtureSeq++).padStart(3, "0")}`;
  FIXTURE_SESSIONS.forEach((sessionId, si) => {
    FIXTURE_PAGES.forEach((page, pi) => {
      rawEvents.push({
        eventId: nextFixtureId(),
        sessionId,
        eventType: "page_view",
        url: `https://example.com${page}`,
        occurredAt: new Date(Date.now() - (si * 10 + pi) * 60000).toISOString(),
        properties: { title: page },
      });
    });
  });
  rawEvents.push({
    eventId: nextFixtureId(),
    sessionId: FIXTURE_SESSIONS[0],
    eventType: "error",
    url: "https://example.com/checkout",
    properties: { message: "TypeError: cart is undefined" },
  });

  const result = await ingestBatch({ project, rawEvents, req: fakeRequest(project) });
  logger.info(result, "fixture events ingested (Mongo now, ClickHouse once the worker drains events:v2)");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Fixture seed failed:", err);
  process.exit(1);
});
