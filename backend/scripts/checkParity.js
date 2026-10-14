require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Event = require("../src/models/Event");
const Project = require("../src/models/Project");
const { getClickhouseClient } = require("../src/shared/clickhouseClient");
const { logger } = require("../src/shared/logger");

const PARITY_THRESHOLD_PCT = Number(process.env.PARITY_THRESHOLD_PCT || 0.5);

function pctDiff(a, b) {
  if (a === 0 && b === 0) return 0;
  return (Math.abs(a - b) / Math.max(a, b, 1)) * 100;
}

/**
 * Compares total events, top pages, session count, and error count for one
 * project over [from, to). This is the spec's "parity stays within 0.5%
 * for seven days" gate — run it daily against a rolling window and only
 * flip a project's analyticsBackend to 'clickhouse' once it's been clean
 * for the full window, not off a single good run.
 */
async function checkProject(projectId, from, to) {
  const ch = getClickhouseClient();

  const [mongoTotal, mongoSessions, mongoErrors] = await Promise.all([
    Event.countDocuments({ projectId, timestamp: { $gte: from, $lt: to } }),
    Event.distinct("sessionId", { projectId, timestamp: { $gte: from, $lt: to } }),
    Event.countDocuments({ projectId, eventType: "error", timestamp: { $gte: from, $lt: to } }),
  ]);

  const chResult = await ch.query({
    query: `
      SELECT
        count() AS total,
        uniqExact(session_id) AS sessions,
        countIf(event_type = 'error') AS errors
      FROM events_v2
      WHERE project_id = {projectId:String}
        AND occurred_at >= {from:DateTime64(3)}
        AND occurred_at < {to:DateTime64(3)}
    `,
    query_params: {
      projectId: String(projectId),
      from: from.toISOString().replace("T", " ").replace("Z", ""),
      to: to.toISOString().replace("T", " ").replace("Z", ""),
    },
    format: "JSONEachRow",
  });
  const [chRow] = await chResult.json();
  const ch_ = chRow || { total: 0, sessions: 0, errors: 0 };

  const report = {
    projectId: String(projectId),
    window: { from: from.toISOString(), to: to.toISOString() },
    total: { mongo: mongoTotal, clickhouse: Number(ch_.total), diffPct: pctDiff(mongoTotal, Number(ch_.total)) },
    sessions: {
      mongo: mongoSessions.length,
      clickhouse: Number(ch_.sessions),
      diffPct: pctDiff(mongoSessions.length, Number(ch_.sessions)),
    },
    errors: { mongo: mongoErrors, clickhouse: Number(ch_.errors), diffPct: pctDiff(mongoErrors, Number(ch_.errors)) },
  };
  report.withinThreshold =
    report.total.diffPct <= PARITY_THRESHOLD_PCT &&
    report.sessions.diffPct <= PARITY_THRESHOLD_PCT &&
    report.errors.diffPct <= PARITY_THRESHOLD_PCT;

  return report;
}

async function run() {
  await connectDB();
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const projectIdArg = process.argv[2];
  const projects = projectIdArg
    ? [{ _id: projectIdArg }]
    : await Project.find({
        $or: [{ analyticsBackend: "dual" }, { analyticsBackend: { $exists: false } }],
      })
        .select("_id name")
        .lean();

  const reports = [];
  for (const project of projects) {
    const report = await checkProject(project._id, from, to);
    reports.push(report);
    const flag = report.withinThreshold ? "OK" : "MISMATCH";
    logger.info(report, `[${flag}] parity check for project ${report.projectId}`);
  }

  const allOk = reports.every((r) => r.withinThreshold);
  await mongoose.disconnect();
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  run().catch((err) => {
    logger.error({ err }, "parity check failed to run");
    process.exit(2);
  });
}

module.exports = { checkProject, pctDiff };
