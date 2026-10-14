require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Project = require("../src/models/Project");
const { logger } = require("../src/shared/logger");

const VALID = ["mongo", "dual", "clickhouse"];

async function run() {
  const [projectId, backend] = process.argv.slice(2);

  if (!projectId || !VALID.includes(backend)) {
    console.error(`Usage: node scripts/setAnalyticsBackend.js <projectId> <${VALID.join("|")}>`);
    console.error("\nRollout order per project: mongo -> dual -> (backfill + checkParity clean for 7 days) -> clickhouse");
    process.exit(1);
  }

  await connectDB();
  const project = await Project.findById(projectId);
  if (!project) {
    console.error(`No project found with id ${projectId}`);
    process.exit(1);
  }

  const from = project.analyticsBackend;
  project.analyticsBackend = backend;
  await project.save();

  logger.info({ projectId, from, to: backend }, "analyticsBackend flag updated");
  if (backend === "clickhouse" && from !== "clickhouse") {
    logger.warn(
      "This project's dashboard now reads from ClickHouse. Make sure npm run backfill:clickhouse and " +
        "npm run check:parity have both been run and are clean for this project before trusting it in production.",
    );
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed to update analyticsBackend:", err);
  process.exit(1);
});
