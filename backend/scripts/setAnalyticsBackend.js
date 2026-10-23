require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Project = require("../src/models/Project");
const ParityRun = require("../src/models/ParityRun");
const MigrationCheckpoint = require("../src/models/MigrationCheckpoint");
const { logger } = require("../src/shared/logger");

const VALID = ["mongo", "dual", "clickhouse"];
const ALLOWED_TRANSITIONS = [
  ["mongo", "dual"],
  ["dual", "mongo"],
  ["dual", "clickhouse"],
  ["clickhouse", "dual"],
];
const DAY_MS = 24 * 60 * 60 * 1000;

function isAllowedTransition(from, to) {
  return ALLOWED_TRANSITIONS.some(([source, target]) => source === from && target === to);
}

function evaluateCutoverGate({ from, to, runs = [], checkpoint, now = new Date() }) {
  if (!isAllowedTransition(from, to)) {
    return [`Transition from ${from} to ${to} is not allowed.`];
  }
  if (to !== "clickhouse") return [];

  const problems = [];
  if (!checkpoint || !(checkpoint.processedCount > 0)) {
    problems.push("A completed backfill checkpoint with processedCount > 0 is required.");
  }

  const newestRuns = Array.isArray(runs)
    ? runs.slice().sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 7)
    : [];
  if (newestRuns.length < 7) {
    problems.push(`need 7 parity runs; found ${newestRuns.length}.`);
    return problems;
  }

  if (newestRuns.some((run) => !run.withinThreshold)) {
    problems.push("One or more of the newest 7 parity runs are out of threshold.");
  }

  for (let i = 1; i < newestRuns.length; i++) {
    const previousDay = Date.parse(`${newestRuns[i - 1].day}T00:00:00.000Z`);
    const currentDay = Date.parse(`${newestRuns[i].day}T00:00:00.000Z`);
    if (!Number.isFinite(previousDay) || !Number.isFinite(currentDay) || previousDay - currentDay !== DAY_MS) {
      problems.push("Parity runs must cover 7 consecutive UTC days with no gaps.");
      break;
    }
  }

  const newest = newestRuns[0];
  const newestTime = newest.ranAt ? new Date(newest.ranAt).getTime() : Date.parse(`${newest.day}T00:00:00.000Z`);
  if (!Number.isFinite(newestTime) || now.getTime() - newestTime > DAY_MS) {
    problems.push("The newest parity run is stale (older than 1 day).");
  }

  if (newestRuns.every((run) => run.report?.total?.mongo === 0)) {
    problems.push("Parity is untested: zero events across all newest 7 runs.");
  }

  return problems;
}

async function run() {
  const [projectId, backend, ...flags] = process.argv.slice(2);
  const force = flags.includes("--force");
  if (!projectId || !VALID.includes(backend) || flags.some((flag) => flag !== "--force")) {
    console.error(`Usage: node scripts/setAnalyticsBackend.js <projectId> <${VALID.join("|")}> [--force]`);
    process.exit(1);
  }

  await connectDB();
  const project = await Project.findById(projectId);
  if (!project) {
    console.error(`No project found with id ${projectId}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const from = project.analyticsBackend;
  const [runs, checkpoint] = await Promise.all([
    ParityRun.find({ projectId }).sort({ day: -1 }).limit(10).lean(),
    MigrationCheckpoint.findOne({ key: `backfill:clickhouse:${String(projectId)}` }).lean(),
  ]);
  const problems = evaluateCutoverGate({ from, to: backend, runs, checkpoint });

  if (problems.length && (!force || !isAllowedTransition(from, backend))) {
    problems.forEach((problem) => console.error(problem));
    await mongoose.disconnect();
    process.exit(2);
  }
  if (problems.length) {
    logger.warn({ projectId, from, to: backend, problems }, "forcing analytics backend transition despite cutover gate");
  }

  if (from === "clickhouse" && backend === "dual") {
    logger.warn(
      { projectId, analyticsBackendSince: project.analyticsBackendSince || null },
      "ROLLBACK WARNING: Mongo received no writes since analyticsBackendSince; writes made while on ClickHouse may be missing from Mongo.",
    );
  }

  project.analyticsBackend = backend;
  project.analyticsBackendSince = new Date();
  await project.save();

  logger.info({ projectId, from, to: backend }, "analyticsBackend flag updated");
  logger.warn("API-key project snapshots may take up to 60 seconds to reflect this change.");
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error("Failed to update analyticsBackend:", err);
    process.exit(1);
  });
}

module.exports = { evaluateCutoverGate };
