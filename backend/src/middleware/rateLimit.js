const { checkRateLimit } = require("../shared/rateLimiter");
const { getRedisClient } = require("../shared/redisClient");
const { RateLimitError } = require("../shared/errors");
let rateLimited = { inc: () => {} };
try {
  ({ rateLimited } = require("../shared/metrics"));
} catch {}
const { getClientIp } = require("../services/geo");

const API_KEY_LIMIT = Number(process.env.RATE_LIMIT_PER_KEY_PER_MIN || 1000);
const IP_LIMIT = Number(process.env.RATE_LIMIT_PER_IP_PER_MIN || 2000);
const SESSION_LIMIT = Number(process.env.RATE_LIMIT_PER_SESSION_PER_MIN || 120);

function sessionIdOf(body) {
  const s = body?.events?.[0]?.sessionId ?? body?.sessionId ?? body?.session_id;
  return typeof s === "string" && s ? s.slice(0, 200) : null;
}

/**
 * Runs after apiKeyAuth (needs req.project). The IP, visitor-session, and
 * API-key limits guard against abuse at each of those scopes.
 */
async function ingestRateLimit(req, res, next) {
  const redis = getRedisClient();
  const ip = getClientIp(req) || "unknown";

  try {
    await checkRateLimit(redis, { scope: "ip", key: ip, limit: IP_LIMIT, windowSeconds: 60 });
    if (req.project) {
      const sid = sessionIdOf(req.body);
      if (sid) {
        await checkRateLimit(redis, {
          scope: "session",
          key: `${req.project._id}:${sid}`,
          limit: SESSION_LIMIT,
          windowSeconds: 60,
        });
      }
      await checkRateLimit(redis, {
        scope: "api_key",
        key: String(req.project._id),
        limit: API_KEY_LIMIT,
        windowSeconds: 60,
      });
    }
    next();
  } catch (error) {
    if (error instanceof RateLimitError) {
      const scope = /for (\w+)/.exec(error.message)?.[1] || "unknown";
      rateLimited.inc({ scope });
      res.set("Retry-After", String(error.retryAfterSeconds));
      return res.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
    }
    next(error);
  }
}

module.exports = { ingestRateLimit };
