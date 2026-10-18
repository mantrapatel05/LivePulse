const { checkRateLimit } = require("../shared/rateLimiter");
const { getRedisClient } = require("../shared/redisClient");
const { RateLimitError } = require("../shared/errors");
const { getClientIp } = require("../services/geo");
let rateLimited = { inc: () => {} };
try {
  ({ rateLimited } = require("../shared/metrics"));
} catch {}

const USER_LIMIT = Number(process.env.DASHBOARD_RATE_LIMIT_PER_USER_PER_MIN || 300);
const IP_LIMIT = Number(process.env.DASHBOARD_RATE_LIMIT_PER_IP_PER_MIN || 600);

async function dashboardRateLimit(req, res, next) {
  try {
    const redis = getRedisClient();
    const ip = getClientIp(req) || "unknown";
    if (req.user?.id) {
      await checkRateLimit(redis, {
        scope: "dashboard_user",
        key: String(req.user.id),
        limit: USER_LIMIT,
        windowSeconds: 60,
      });
    }
    await checkRateLimit(redis, {
      scope: "dashboard_ip",
      key: ip,
      limit: IP_LIMIT,
      windowSeconds: 60,
    });
    return next();
  } catch (error) {
    if (!(error instanceof RateLimitError)) return next(error);
    const scope = error.message.includes("dashboard_ip") ? "dashboard_ip" : "dashboard_user";
    rateLimited.inc({ scope });
    res.set("Retry-After", String(error.retryAfterSeconds));
    return res.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
  }
}

module.exports = { dashboardRateLimit };
