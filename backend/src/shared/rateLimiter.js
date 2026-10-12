const { RateLimitError } = require("./errors");

// Fixed-window counter via INCR + EXPIRE NX. Simpler than a sliding-window

async function checkRateLimit(redis, { scope, key, limit, windowSeconds }) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const redisKey = `ratelimit:${scope}:${key}:${bucket}`;

  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSeconds);

  if (count > limit) {
    const ttl = await redis.ttl(redisKey);
    throw new RateLimitError(`Rate limit exceeded for ${scope}`, ttl > 0 ? ttl : windowSeconds);
  }
  return { count, limit, remaining: Math.max(0, limit - count) };
}

module.exports = { checkRateLimit };
