require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Project = require("../src/models/Project");
const { generateApiKey } = require("../src/shared/apiKeyHash");
const { ingestBatch } = require("../src/shared/ingestPipeline");
const { logger } = require("../src/shared/logger");

const FIXTURE_PROJECT_ID = "699d9becf25204ae69676bbb";
const FIXTURE_USER_ID = "local-dev-fixture-user";

// Deterministic on purpose -- rerunning this script against a fresh
// docker-compose stack always produces the exact same data, which is what
// makes it useful for comparing Mongo vs ClickHouse output while working
// on the migration/parity tooling.
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

  const rawEvents = [];
  FIXTURE_SESSIONS.forEach((sessionId, si) => {
    FIXTURE_PAGES.forEach((page, pi) => {
      rawEvents.push({
        sessionId,
        eventType: "page_view",
        url: `https://example.com${page}`,
        occurredAt: new Date(Date.now() - (si * 10 + pi) * 60000).toISOString(),
        properties: { title: page },
      });
    });
  });
  rawEvents.push({
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
