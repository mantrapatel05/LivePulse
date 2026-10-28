const {
  buildSessionSummaryQuery,
  buildSessionTimelineEventsQuery,
  buildErrorClusterInsightQuery,
  buildErrorClusterRepresentativeSessionsQuery,
  runQuery,
} = require("../shared/analyticsQueries");
const { getRedisClient } = require("../shared/redisClient");
const { checkRateLimit } = require("../shared/rateLimiter");
const { RateLimitError } = require("../shared/errors");
const { isConfigured, LlmUnavailableError, LlmBadOutputError } = require("../shared/llm/llmClient");
const { buildSessionDigest } = require("../shared/insights/buildSessionDigest");
const { generateSessionInsight, deterministicInsight } = require("../shared/insights/sessionInsight");
const {
  buildErrorClusterDigest,
  generateErrorClusterInsight,
  deterministicErrorInsight,
} = require("../shared/insights/errorClusterInsight");
const { parseRange, clickhouseOnly, respond } = require("./analyticsV2Controller");
const { aiInsightRequests, aiInsightLatency, aiTokens } = require("../shared/metrics");
const { logger } = require("../shared/logger");

const positiveEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const USER_LIMIT = () => positiveEnv("AI_INSIGHT_PER_USER_PER_MIN", 10);
const PROJECT_LIMIT = () => positiveEnv("AI_INSIGHT_PER_PROJECT_PER_MIN", 30);
const DAILY_LIMIT = () => positiveEnv("AI_INSIGHT_DAILY_CALLS_PER_PROJECT", 100);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function metric(kind, result) {
  aiInsightRequests.inc({ kind, result });
}

function chDate(value) {
  return new Date(value).toISOString().replace("T", " ").replace("Z", "");
}

function asIso(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "");
  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid ClickHouse timestamp");
  return date.toISOString();
}

function enabled(req, res) {
  if (!clickhouseOnly(req, res)) {
    metric("session", "error");
    return false;
  }
  if (req.project.aiInsights?.enabled !== true) {
    metric("session", "disabled");
    res.status(403).json({ message: "AI insights are disabled for this project" });
    return false;
  }
  return true;
}

async function enforceRateLimits(req, res, kind, redis, projectId) {
  try {
    await checkRateLimit(redis, {
      scope: "ai_insight_user",
      key: String(req.user.id),
      limit: USER_LIMIT(),
      windowSeconds: 60,
    });
    await checkRateLimit(redis, {
      scope: "ai_insight_project",
      key: projectId,
      limit: PROJECT_LIMIT(),
      windowSeconds: 60,
    });
    return true;
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error;
    res.set("Retry-After", String(error.retryAfterSeconds));
    metric(kind, "rate_limited");
    res.status(429).json({ message: "AI insight rate limit reached", retryAfterSeconds: error.retryAfterSeconds });
    return false;
  }
}

function usageMetrics(usage) {
  aiTokens.inc({ direction: "input" }, Number(usage?.inputTokens) || 0);
  aiTokens.inc({ direction: "output" }, Number(usage?.outputTokens) || 0);
}

function nextUtcMidnight(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

async function serveInsight({ req, res, kind, projectId, digestHash, digest, idMap, hasStackSignal, lastSeenAt, range }) {
  const redis = getRedisClient();
  const cacheKey = `ai:insight:v1:${projectId}:${digestHash}`;
  const materialize = (insight) => {
    if (kind !== "session" || !Array.isArray(insight?.friction) || !idMap) return insight;
    return {
      ...insight,
      friction: insight.friction.map((item) => {
        if (!Array.isArray(item.evidenceRefs)) return item;
        const eventIds = item.evidenceRefs.map((id) => idMap[id]).filter(Boolean);
        if (eventIds.length !== item.evidenceRefs.length) return null;
        return { ...item, evidenceIds: eventIds, eventIds };
      }).filter(Boolean),
    };
  };
  const render = (value, cached, degraded = false) => respond(res, {
    insight: materialize(value.insight),
    cached,
    model: value.model || null,
    generatedAt: value.generatedAt || new Date().toISOString(),
    ...(degraded ? { degraded: true } : {}),
  }, range);

  const cached = await redis.get(cacheKey);
  if (cached) {
    metric(kind, "cached");
    return render(JSON.parse(cached), true);
  }

  const lockKey = `ai:lock:${cacheKey}`;
  const lockValue = `${process.pid}:${Date.now()}:${Math.random()}`;
  // Leave enough time for two bounded provider attempts (15s each) plus retry jitter.
  const gotLock = await redis.set(lockKey, lockValue, "EX", 45, "NX");
  if (!gotLock) {
    for (let index = 0; index < 16; index += 1) {
      await sleep(500);
      const pendingResult = await redis.get(cacheKey);
      if (pendingResult) {
        metric(kind, "cached");
        return render(JSON.parse(pendingResult), true);
      }
    }
    return res.status(202).json({ status: "pending" });
  }

  const rechecked = await redis.get(cacheKey);
  if (rechecked) {
    await redis.del(lockKey);
    metric(kind, "cached");
    return render(JSON.parse(rechecked), true);
  }

  const day = new Date().toISOString().slice(0, 10);
  const budgetKey = `ai:budget:${projectId}:${day}`;
  const used = await redis.incr(budgetKey);
  if (used === 1) await redis.expire(budgetKey, 2 * 86400);
  if (used > DAILY_LIMIT()) {
    await redis.decr(budgetKey);
    await redis.del(lockKey);
    metric(kind, "budget");
    return res.status(429).json({ message: "Daily AI insight limit reached for this project", resetsAt: nextUtcMidnight() });
  }

  const startedAt = Date.now();
  try {
    let generated;
    try {
      generated = kind === "session"
        ? await generateSessionInsight({ digest, idMap })
        : await generateErrorClusterInsight({ digest, hasStackSignal });
    } catch (error) {
      if (!(error instanceof LlmUnavailableError) && !(error instanceof LlmBadOutputError)) throw error;
      await redis.decr(budgetKey).catch(() => {});
      aiInsightLatency.observe(Date.now() - startedAt);
      metric(kind, "degraded");
      logger.warn({ outcome: "degraded", model: process.env.LLM_MODEL || "unconfigured", inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startedAt }, "AI insight generation degraded");
      const fallback = kind === "session" ? deterministicInsight(digest, idMap) : deterministicErrorInsight(digest);
      return render({ insight: fallback, model: null }, false, true);
    }

    usageMetrics(generated.usage);
    const generatedAt = new Date().toISOString();
    const cacheInsight = kind === "session"
      ? {
          ...generated.insight,
          friction: generated.insight.friction.map((item) => {
            const safe = { ...item };
            delete safe.evidenceIds;
            delete safe.eventIds;
            return safe;
          }),
        }
      : generated.insight;
    const cacheValue = { insight: cacheInsight, model: generated.model, generatedAt };
    const isLive = lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 10 * 60 * 1000;
    await redis.set(cacheKey, JSON.stringify(cacheValue), "EX", isLive ? 600 : 7 * 86400);
    aiInsightLatency.observe(Date.now() - startedAt);
    metric(kind, "ok");
    logger.info({ outcome: "ok", model: generated.model, inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, latencyMs: Date.now() - startedAt }, "AI insight generated");
    return render(cacheValue, false);
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockValue,
    ).catch(() => {});
  }
}

async function explainSession(req, res) {
  const kind = "session";
  if (!enabled(req, res)) return;
  const projectId = String(req.project._id);
  if (!req.params.sessionId || req.params.sessionId.length > 256) return res.status(400).json({ message: "Invalid sessionId." });
  const redis = getRedisClient();
  if (!(await enforceRateLimits(req, res, kind, redis, projectId))) return;
  if (!isConfigured()) {
    metric(kind, "disabled");
    return res.status(503).json({ message: "AI insights are disabled because the LLM provider is not configured on this server." });
  }

  try {
    const { sessionId } = req.params;
    const summaries = await runQuery(buildSessionSummaryQuery({ projectId, sessionId }), "ai_session_summary");
    const summary = summaries[0];
    if (!summary || summary.started_at == null) return res.status(404).json({ message: "Session not found." });
    const startedAt = asIso(summary.started_at);
    const lastSeenAt = asIso(summary.last_seen_at);
    const events = await runQuery(buildSessionTimelineEventsQuery({
      projectId,
      sessionId,
      startedAt: chDate(startedAt),
      lastSeenAt: chDate(lastSeenAt),
    }), "ai_session_timeline");
    const built = buildSessionDigest({ summary, events });
    return await serveInsight({ req, res, kind, projectId, ...built, lastSeenAt, range: null });
  } catch (error) {
    metric(kind, "error");
    logger.warn({ outcome: "error", model: process.env.LLM_MODEL || "unconfigured", inputTokens: 0, outputTokens: 0, latencyMs: 0 }, "AI session insight request failed");
    throw error;
  }
}

async function explainErrorCluster(req, res) {
  const kind = "error_cluster";
  if (!clickhouseOnly(req, res)) {
    metric(kind, "error");
    return;
  }
  if (req.project.aiInsights?.enabled !== true) {
    metric(kind, "disabled");
    return res.status(403).json({ message: "AI insights are disabled for this project" });
  }
  const source = req.body || {};
  const range = parseRange(req, res, source);
  if (!range) return;
  const signature = typeof source.signature === "string" ? source.signature.trim() : "";
  if (!signature || signature.length > 500) return res.status(400).json({ message: "Provide a valid error cluster signature." });

  const projectId = String(req.project._id);
  const redis = getRedisClient();
  if (!(await enforceRateLimits(req, res, kind, redis, projectId))) return;
  if (!isConfigured()) {
    metric(kind, "disabled");
    return res.status(503).json({ message: "AI insights are disabled because the LLM provider is not configured on this server." });
  }

  try {
    const params = { projectId, from: range.from, to: range.to, signature };
    const rows = await runQuery(buildErrorClusterInsightQuery(params), "ai_error_cluster");
    const cluster = rows[0];
    if (!cluster) return res.status(404).json({ message: "Error cluster not found in this date range." });

    const sessions = await runQuery(buildErrorClusterRepresentativeSessionsQuery(params), "ai_error_cluster_sessions");
    const representativeDigests = await Promise.all(sessions.slice(0, 5).map(async (session) => {
      const summaryRows = await runQuery(buildSessionSummaryQuery({ projectId, sessionId: session.session_id }), "ai_error_cluster_session_summary");
      const summary = summaryRows[0];
      if (!summary?.started_at) return null;
      const startedAt = asIso(summary.started_at);
      const lastSeenAt = asIso(summary.last_seen_at);
      const events = await runQuery(buildSessionTimelineEventsQuery({
        projectId,
        sessionId: session.session_id,
        startedAt: chDate(startedAt),
        lastSeenAt: chDate(lastSeenAt),
      }), "ai_error_cluster_session_timeline");
      return buildSessionDigest({ summary, events }).digest;
    }));
    const built = buildErrorClusterDigest({ cluster, sessions: representativeDigests.filter(Boolean).map((digest) => ({ digest })) });
    return await serveInsight({
      req,
      res,
      kind,
      projectId,
      digest: built.digest,
      digestHash: built.digestHash,
      hasStackSignal: built.hasStackSignal,
      lastSeenAt: cluster.last_seen ? asIso(cluster.last_seen) : null,
      range: range.responseRange,
    });
  } catch (error) {
    metric(kind, "error");
    logger.warn({ outcome: "error", model: process.env.LLM_MODEL || "unconfigured", inputTokens: 0, outputTokens: 0, latencyMs: 0 }, "AI error insight request failed");
    throw error;
  }
}

async function updateAiInsightsSettings(req, res) {
  const { enabled: isEnabled, ...rest } = req.body || {};
  if (Object.keys(rest).length || typeof isEnabled !== "boolean") {
    return res.status(400).json({ message: "Provide { enabled: boolean }" });
  }
  req.project.set("aiInsights.enabled", isEnabled);
  await req.project.save();
  return res.status(200).json({
    message: "AI insight settings updated",
    project: { _id: String(req.project._id), aiInsights: { enabled: isEnabled } },
  });
}

module.exports = { explainSession, explainErrorCluster, updateAiInsightsSettings };
