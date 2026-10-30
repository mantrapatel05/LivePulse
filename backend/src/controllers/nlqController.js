const crypto = require("crypto");
const { runQuery } = require("../shared/analyticsQueries");
const { getRedisClient } = require("../shared/redisClient");
const { checkRateLimit } = require("../shared/rateLimiter");
const { RateLimitError } = require("../shared/errors");
const { LlmUnavailableError, LlmBadOutputError } = require("../shared/llm/llmClient");
const { translateQuestion, prepareQuestion, MAX_QUESTION } = require("../shared/nlq/translate");
const { validateSpec, SpecError, describeSpec, TIME_GROUPS } = require("../shared/nlq/querySpec");
const { compileSpec } = require("../shared/nlq/compileSpec");
const { clickhouseOnly, respond } = require("./analyticsV2Controller");
const { nlqRequests, aiTokens } = require("../shared/metrics");
const { logger } = require("../shared/logger");

const positiveEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const USER_LIMIT = () => positiveEnv("NLQ_PER_USER_PER_MIN", 10);
const PROJECT_LIMIT = () => positiveEnv("NLQ_PER_PROJECT_PER_MIN", 30);
const DAILY_LIMIT = () => positiveEnv("NLQ_DAILY_CALLS_PER_PROJECT", 100);
const SPEC_TTL_SECONDS = 3600;
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const UNAVAILABLE = { status: "unavailable", message: "Couldn't interpret that right now." };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function secondsUntilUtcMidnight(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function isTooHeavy(error) {
  const type = String(error?.type || "");
  const code = String(error?.code || "");
  return /TIMEOUT_EXCEEDED|TOO_MANY_ROWS|TOO_MANY_BYTES|MEMORY_LIMIT_EXCEEDED|TOO_SLOW/.test(type)
    || ["159", "158", "241", "160"].includes(code)
    || error?.name === "TimeoutError";
}

async function readCachedSpec(redis, key) {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return validateSpec(JSON.parse(raw));
  } catch {
    await redis.del(key).catch(() => {});
    return null;
  }
}

const finiteOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function timeLabel(value) {
  const text = String(value ?? "");
  const date = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : text;
}

function shapeRows(rows, spec) {
  const limit = spec.groupBy ? spec.limit : 1;
  const timeGroup = TIME_GROUPS.has(spec.groupBy);
  return {
    truncated: rows.length > limit,
    rows: rows.slice(0, limit).map((row) => ({
      ...(spec.groupBy ? { label: timeGroup ? timeLabel(row.label) : String(row.label ?? "") } : {}),
      value: finiteOrNull(row.value),
    })),
  };
}

async function askAnalytics(req, res) {
  const startedAt = Date.now();
  let loggedSpec = null;
  const note = (result) => {
    nlqRequests.inc({ result });
    logger.info({
      outcome: result,
      latencyMs: Date.now() - startedAt,
      ...(loggedSpec && !loggedSpec.unsupported
        ? { metric: loggedSpec.metric, groupBy: loggedSpec.groupBy, range: loggedSpec.range }
        : {}),
    }, "nlq request");
  };
  const fail = (result, status, body) => {
    note(result);
    return res.status(status).json(body);
  };
  const ok = (result, data, range = null) => {
    note(result);
    return respond(res, data, range);
  };

  if (!clickhouseOnly(req, res)) return note("disabled");
  if (req.project.aiInsights?.enabled !== true) {
    return fail("disabled", 403, { message: "AI features are disabled for this project" });
  }

  const rawQuestion = req.body?.question;
  if (typeof rawQuestion !== "string" || !rawQuestion.trim()) return res.status(400).json({ message: "Provide a question." });
  if (rawQuestion.length > MAX_QUESTION) {
    return res.status(400).json({ message: `Questions can be at most ${MAX_QUESTION} characters.` });
  }
  const question = prepareQuestion(rawQuestion);
  if (question.length < 3) return res.status(400).json({ message: "Provide a question." });

  const redis = getRedisClient();
  const projectId = String(req.project._id);
  try {
    await checkRateLimit(redis, { scope: "nlq_user", key: String(req.user.id), limit: USER_LIMIT(), windowSeconds: 60 });
    await checkRateLimit(redis, { scope: "nlq_project", key: projectId, limit: PROJECT_LIMIT(), windowSeconds: 60 });
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error;
    res.set("Retry-After", String(error.retryAfterSeconds));
    return fail("rate_limited", 429, { message: "Question rate limit reached", retryAfterSeconds: error.retryAfterSeconds });
  }

  const hash = crypto.createHash("sha256").update(question.toLowerCase()).digest("hex");
  const cacheKey = `nlq:spec:v1:${projectId}:${hash}`;
  let spec = await readCachedSpec(redis, cacheKey);
  let cachedSpec = Boolean(spec);

  if (!spec) {
    const lockKey = `nlq:lock:${cacheKey}`;
    const lockValue = `${process.pid}:${Date.now()}:${Math.random()}`;
    const gotLock = await redis.set(lockKey, lockValue, "EX", 45, "NX");
    if (!gotLock) {
      for (let attempt = 0; attempt < 16 && !spec; attempt += 1) {
        await sleep(500);
        spec = await readCachedSpec(redis, cacheKey);
      }
      if (!spec) return res.status(202).json({ status: "pending" });
      cachedSpec = true;
    } else {
      try {
        spec = await readCachedSpec(redis, cacheKey);
        if (spec) {
          cachedSpec = true;
        } else {
          const day = new Date().toISOString().slice(0, 10);
          const budgetKey = `ai:nlq:${projectId}:${day}`;
          const used = await redis.incr(budgetKey);
          if (used === 1) await redis.expire(budgetKey, 2 * 86400);
          if (used > DAILY_LIMIT()) {
            await redis.decr(budgetKey);
            const retryAfterSeconds = secondsUntilUtcMidnight();
            res.set("Retry-After", String(retryAfterSeconds));
            return fail("budget", 429, {
              message: "Daily question limit reached for this project",
              resetsAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
            });
          }
          try {
            const generated = await translateQuestion(question);
            spec = generated.spec;
            aiTokens.inc({ direction: "input" }, Number(generated.usage?.inputTokens) || 0);
            aiTokens.inc({ direction: "output" }, Number(generated.usage?.outputTokens) || 0);
            await redis.set(cacheKey, JSON.stringify(spec), "EX", SPEC_TTL_SECONDS);
          } catch (error) {
            if (error instanceof SpecError) return ok("invalid_spec", UNAVAILABLE);
            if (error instanceof LlmUnavailableError) {
              await redis.decr(budgetKey).catch(() => {});
              return ok("degraded", UNAVAILABLE);
            }
            if (error instanceof LlmBadOutputError) return ok("degraded", UNAVAILABLE);
            throw error;
          }
        }
      } finally {
        await redis.eval(RELEASE, 1, lockKey, lockValue).catch(() => {});
      }
    }
  }
  loggedSpec = spec;

  if (spec.unsupported) return ok("unsupported", { status: "unsupported", message: spec.unsupported });

  const compiled = compileSpec(spec, { projectId });
  let rows;
  try {
    rows = await runQuery({
      query: compiled.query,
      query_params: compiled.query_params,
      clickhouse_settings: compiled.clickhouse_settings,
    }, "v2_nlq");
  } catch (error) {
    if (isTooHeavy(error)) {
      return ok("too_heavy", { status: "too_heavy", message: "That question scans too much data. Try a shorter time range." });
    }
    logger.warn({ err: error?.name, type: error?.type, code: error?.code }, "nlq query failed");
    return fail("error", 500, { message: "Internal server error." });
  }

  const shaped = shapeRows(rows, spec);
  return ok(cachedSpec ? "cached_spec" : "ok", {
    status: "ok",
    interpreted: describeSpec(spec),
    spec,
    columns: compiled.columns,
    rows: shaped.rows,
    truncated: shaped.truncated,
    cached: cachedSpec,
  }, compiled.range);
}

module.exports = { askAnalytics, shapeRows, isTooHeavy };
