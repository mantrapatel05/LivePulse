const {
  buildTopPagesQuery,
  buildEngagementWindowQuery,
  buildPageDeltaQuery,
  buildErrorClustersRangeQuery,
  runQuery,
} = require("../analyticsQueries");
const { computeDrift } = require("../insights/engagementDrift");
const { buildDigest } = require("./buildDigest");
const { generateDigestParagraph } = require("./digestLlm");
const { sendEmail } = require("./emailClient");
const { signUnsubscribeToken } = require("./token");
const { isConfigured: llmConfigured } = require("../llm/llmClient");
const { logger } = require("../logger");
const { digestSends } = require("../metrics");

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_TTL_SECONDS = 15 * 60;
const SENT_TTL_SECONDS = 14 * 24 * 60 * 60;
const MAX_ATTEMPTS = 3;
const toClickhouseDate = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const toDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dailyLimit = () => Number(process.env.AI_INSIGHT_DAILY_CALLS_PER_PROJECT) > 0
  ? Number(process.env.AI_INSIGHT_DAILY_CALLS_PER_PROJECT)
  : 100;
const RELEASE_CLAIM = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function markSent(projectId, week) {
  const Project = require("../../models/Project");
  await Project.updateOne({ _id: projectId }, { $set: { "digest.lastSentWeek": week } });
}

async function paragraphWithinBudget(redis, project, data, generate, configured) {
  if (!configured) return null;
  const projectId = String(project._id);
  const key = `ai:budget:${projectId}:${new Date().toISOString().slice(0, 10)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * 86400);
  if (used > dailyLimit()) {
    await redis.decr(key);
    return null;
  }
  try {
    return await generate(data);
  } catch (error) {
    await redis.decr(key).catch(() => {});
    logger.warn({ projectId, err: error?.name }, "digest paragraph failed; using deterministic digest");
    return null;
  }
}

async function processProject(project, week, deps = {}) {
  const redis = deps.redis;
  const query = deps.runQuery || runQuery;
  const send = deps.sendEmail || sendEmail;
  const generate = deps.generateParagraph || generateDigestParagraph;
  const saveSent = deps.markSent || markSent;
  const nowMs = deps.now ? deps.now() : Date.now();
  const configured = deps.llmConfigured !== undefined ? deps.llmConfigured : llmConfigured();
  const projectId = String(project._id);
  const sentKey = `digest:sent:${projectId}:${week}`;
  const attemptsKey = `digest:attempts:${projectId}:${week}`;
  const claim = `pending:${process.pid}:${Math.random()}`;
  const result = (name) => { digestSends.inc({ result: name }); return name; };

  if (project.analyticsBackend !== "clickhouse" || !project.digest?.email) return result("skipped");
  const acquired = await redis.set(sentKey, claim, "EX", PENDING_TTL_SECONDS, "NX");
  if (!acquired) return result("duplicate");

  const release = () => redis.eval(RELEASE_CLAIM, 1, sentKey, claim).catch(() => {});
  try {
    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, SENT_TTL_SECONDS);
    if (attempts > MAX_ATTEMPTS) {
      await redis.set(sentKey, "gave_up", "EX", SENT_TTL_SECONDS);
      return result("failed");
    }

    const currentFrom = nowMs - WINDOW_MS;
    const previousFrom = nowMs - 2 * WINDOW_MS;
    const params = {
      projectId,
      curFrom: toClickhouseDate(currentFrom),
      curTo: toClickhouseDate(nowMs),
      prevFrom: toClickhouseDate(previousFrom),
      prevTo: toClickhouseDate(currentFrom),
    };
    const [currentRows, previousRows, pageDeltaRows, pageRows, errorRows] = await Promise.all([
      query(buildEngagementWindowQuery({ projectId, from: params.curFrom, to: params.curTo }), "digest_current"),
      query(buildEngagementWindowQuery({ projectId, from: params.prevFrom, to: params.prevTo }), "digest_previous"),
      query(buildPageDeltaQuery(params), "digest_page_delta"),
      query(buildTopPagesQuery({ projectId, from: params.curFrom, to: params.curTo, limit: 5 }), "digest_top_pages"),
      query(buildErrorClustersRangeQuery({ projectId, from: params.curFrom, to: params.curTo, limit: 20 }), "digest_errors"),
    ]);

    const drift = computeDrift({ cur: currentRows[0], prev: previousRows[0], pages: pageDeltaRows });
    const eventCount = Number(currentRows[0]?.events) || 0;
    if (drift.status === "insufficient_data" && eventCount === 0) {
      await redis.set(sentKey, "skipped", "EX", SENT_TTL_SECONDS);
      return result("skipped");
    }

    const range = { from: toDay(currentFrom), to: toDay(nowMs) };
    const base = buildDigest({ projectName: project.name, week, range, drift, pages: pageRows, clusters: errorRows });
    const aiParagraph = project.aiInsights?.enabled === true
      ? await paragraphWithinBudget(redis, project, base.data, generate, configured)
      : null;
    const backendUrl = (process.env.PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
    const unsubscribeUrl = `${backendUrl}/api/public/digest/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(projectId))}`;
    const email = buildDigest({
      projectName: project.name,
      week,
      range,
      drift,
      pages: pageRows,
      clusters: errorRows,
      aiParagraph,
      unsubscribeUrl,
    });

    await send({
      to: project.digest.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      unsubscribeUrl,
      idempotencyKey: `digest-${projectId}-${week}`,
    });
    // Keep a durable sent marker before Mongo; provider idempotency covers a crash in this gap.
    await redis.set(sentKey, "sent", "EX", SENT_TTL_SECONDS);
    await saveSent(projectId, week).catch((error) => {
      logger.warn({ projectId, week, err: error?.name }, "digest sent but lastSentWeek was not saved");
    });
    return result("sent");
  } catch (error) {
    logger.warn({ projectId, week, err: error?.name, status: error?.status }, "digest processing failed; retrying next tick");
    await release();
    return result("failed");
  }
}

module.exports = { processProject, MAX_ATTEMPTS };
