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

/**
 * Runs after apiKeyAuth (needs req.project). Two independent limits: a
 * generous per-IP ceiling that mainly guards against a single misbehaving
 * client hammering the endpoint regardless of which key it's using, and a
 * tighter per-key limit that's the real billing/abuse boundary.
 */
async function ingestRateLimit(req, res, next) {
  const redis = getRedisClient();
  const ip = getClientIp(req) || "unknown";

  try {
    await checkRateLimit(redis, { scope: "ip", key: ip, limit: IP_LIMIT, windowSeconds: 60 });
    if (req.project) {
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
      rateLimited.inc({ scope: error.message.includes("ip") ? "ip" : "api_key" });
      res.set("Retry-After", String(error.retryAfterSeconds));
      return res.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
    }
    next(error);
  }
}

module.exports = { ingestRateLimit };
