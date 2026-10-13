const mongoose = require("mongoose");
const { checkRedisReady, getRedisClient } = require("../shared/redisClient");
const { checkClickhouseReady } = require("../shared/clickhouseClient");
const { pendingCount, ensureConsumerGroup } = require("../shared/redisStream");
const { activeCount } = require("../shared/activeSessionState");

/** Cheap, no-dependency check: is the process itself up and event-looping? Render/k8s liveness probes want this instant. */
const liveness = async (_req, res) => {
  res.status(200).json({ status: "ok" });
};

const STREAM_LAG_ALERT_THRESHOLD = Number(process.env.STREAM_LAG_ALERT_THRESHOLD || 5000);

/** Readiness: every dependency the API actually needs to serve traffic correctly. */
const readiness = async (_req, res) => {
  const checks = {};

  checks.mongo = mongoose.connection.readyState === 1;
  checks.redis = await checkRedisReady();
  checks.clickhouse = await checkClickhouseReady();

  let streamPending = null;
  try {
    const redis = getRedisClient();
    await ensureConsumerGroup(redis);
    streamPending = await pendingCount(redis);
    checks.consumerGroup = true;
  } catch {
    checks.consumerGroup = false;
  }
  checks.streamBacklogHealthy = streamPending !== null && streamPending < STREAM_LAG_ALERT_THRESHOLD;

  const ready = checks.mongo && checks.redis && checks.clickhouse && checks.consumerGroup;

  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
    streamPendingCount: streamPending,
  });
};

/** Per-project pipeline visibility for the dashboard's connection/queue health indicator. */
const getProjectHealth = async (req, res) => {
  const redis = getRedisClient();
  const [redisOk, clickhouseOk, streamPending, liveNow] = await Promise.all([
    checkRedisReady(),
    checkClickhouseReady(),
    pendingCount(redis),
    activeCount(redis, String(req.project._id)),
  ]);

  return res.status(200).json({
    data: {
      analyticsBackend: req.project.analyticsBackend,
      redisOk,
      clickhouseOk,
      // events:v2 is one shared stream across every project, so this is a
      // process-wide backlog signal, not a per-project one -- there's no
      // cheap way to scope XPENDING to a single project's entries without
      // a per-project stream, which isn't what the spec asked for here.
      streamPendingCountProcessWide: streamPending,
      liveNow,
    },
    generatedAt: new Date().toISOString(),
  });
};

module.exports = { liveness, readiness, getProjectHealth };
