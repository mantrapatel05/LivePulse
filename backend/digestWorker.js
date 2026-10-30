require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const connectDB = require("./src/config/db");
const Project = require("./src/models/Project");
const { createRedisClient } = require("./src/shared/redisClient");
const { logger } = require("./src/shared/logger");
const { initializeTracing, shutdownTracing, withSpan } = require("./src/shared/tracing");
const { requireMetricsAuth } = require("./src/middleware/metricsAuth");
const { isoWeek, inSendWindow } = require("./src/shared/digest/week");
const { processProject } = require("./src/shared/digest/runDigest");
const { isEmailConfigured } = require("./src/shared/digest/emailClient");

const TICK_MS = 60_000;
const CONCURRENCY = Math.max(1, Number(process.env.DIGEST_CONCURRENCY) || 3);
let running = false;
let shuttingDown = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pool(items, limit, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      try {
        await fn(item);
      } catch (error) {
        logger.error({ projectId: String(item._id), err: error?.name }, "digest project crashed");
      }
    }
  }));
}

async function tick(redis, now = new Date()) {
  if (running || shuttingDown || !inSendWindow(now)) return;
  running = true;
  try {
    const week = isoWeek(now);
    const projects = await Project.find({
      "digest.enabled": true,
      "digest.lastSentWeek": { $ne: week },
      analyticsBackend: "clickhouse",
    }).select("_id name analyticsBackend digest aiInsights").lean();

    const pending = [];
    for (const project of projects) {
      if (!(await redis.exists(`digest:sent:${project._id}:${week}`))) pending.push(project);
    }
    if (pending.length) logger.info({ week, count: pending.length }, "digest tick: sending");
    await pool(pending, CONCURRENCY, (project) => withSpan(
      "livepulse.digest.project", {}, () => processProject(project, week, { redis }),
    ));
  } catch (error) {
    logger.error({ err: error?.name }, "digest tick failed");
  } finally {
    running = false;
  }
}

function startMetricsServer() {
  const { register } = require("./src/shared/metrics");
  const app = express();
  app.get("/metrics", requireMetricsAuth, async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  });
  app.use((_req, res) => res.sendStatus(404));
  const port = Number(process.env.DIGEST_METRICS_PORT || 9465);
  const host = process.env.DIGEST_METRICS_HOST || "127.0.0.1";
  return app.listen(port, host, () => logger.info({ host, port }, "digest metrics listening"));
}

async function main() {
  initializeTracing("livepulse-digest");
  if (!process.env.DIGEST_SECRET || process.env.DIGEST_SECRET.length < 16) throw new Error("DIGEST_SECRET missing");
  if (!isEmailConfigured()) throw new Error("EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM not configured");
  if (!process.env.PUBLIC_BACKEND_URL) throw new Error("PUBLIC_BACKEND_URL missing (needed for unsubscribe links)");
  await connectDB();
  const redis = createRedisClient("digest");
  const metricsServer = startMetricsServer();
  logger.info("digest worker starting");
  const timer = setInterval(() => void tick(redis), TICK_MS);
  void tick(redis);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("SIGTERM received; finishing in-flight digest sends");
    clearInterval(timer);
    while (running) await sleep(200);
    await Promise.allSettled([
      redis.quit(),
      mongoose.disconnect(),
      new Promise((resolve) => metricsServer.close(() => resolve())),
      shutdownTracing(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error({ err: error?.name }, "digest worker crashed");
    process.exit(1);
  });
}

module.exports = { tick, pool, startMetricsServer };
