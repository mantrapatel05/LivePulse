const { createRedisClient } = require("../../src/shared/redisClient");
const activeSessions = require("../../src/shared/activeSessionState");
const { checkRateLimit } = require("../../src/shared/rateLimiter");
const { claimEventId } = require("../../src/shared/idempotency");
const { RateLimitError } = require("../../src/shared/errors");

let redis;

beforeAll(() => {
  redis = createRedisClient("test-hotpath");
});

beforeEach(async () => {
  await redis.flushall();
});

afterAll(async () => {
  await redis.quit();
});

describe("activeSessionState against a real Redis", () => {
  it("tracks and lists live sessions per project, updating currentUrl on repeat touches", async () => {
    await activeSessions.touchSession(redis, { projectId: "p1", sessionId: "s1", url: "/pricing", userId: "u1" });
    await activeSessions.touchSession(redis, { projectId: "p1", sessionId: "s2", url: "/", userId: "u2" });
    await activeSessions.touchSession(redis, { projectId: "p1", sessionId: "s1", url: "/checkout", userId: "u1" });

    const active = await activeSessions.listActiveSessions(redis, "p1");
    expect(active).toHaveLength(2);
    expect(active.find((s) => s.sessionId === "s1").currentUrl).toBe("/checkout");
    expect(await activeSessions.activeCount(redis, "p1")).toBe(2);
  });

  it("sweeps sessions outside the active window even before their key TTL expires", async () => {
    await redis.zadd("active:p1", Date.now() - 10 * 60 * 1000, "s-old");
    const active = await activeSessions.listActiveSessions(redis, "p1", 5 * 60 * 1000);
    expect(active.find((s) => s.sessionId === "s-old")).toBeUndefined();
  });

  it("keeps projects isolated", async () => {
    await activeSessions.touchSession(redis, { projectId: "p1", sessionId: "s1", url: "/" });
    await activeSessions.touchSession(redis, { projectId: "p2", sessionId: "s1", url: "/" });
    expect(await activeSessions.activeCount(redis, "p1")).toBe(1);
    expect(await activeSessions.activeCount(redis, "p2")).toBe(1);
  });
});

describe("rateLimiter against a real Redis", () => {
  it("allows up to the limit then rejects, independent per key", async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await checkRateLimit(redis, { scope: "api_key", key: "k1", limit: 3, windowSeconds: 60 });
      expect(r.count).toBe(i);
    }
    await expect(
      checkRateLimit(redis, { scope: "api_key", key: "k1", limit: 3, windowSeconds: 60 }),
    ).rejects.toBeInstanceOf(RateLimitError);

    const other = await checkRateLimit(redis, { scope: "api_key", key: "k2", limit: 3, windowSeconds: 60 });
    expect(other.count).toBe(1);
  });

  it("reports a sane retryAfterSeconds on rejection", async () => {
    await checkRateLimit(redis, { scope: "ip", key: "1.2.3.4", limit: 1, windowSeconds: 30 });
    try {
      await checkRateLimit(redis, { scope: "ip", key: "1.2.3.4", limit: 1, windowSeconds: 30 });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.retryAfterSeconds).toBeGreaterThan(0);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
  });
});

describe("idempotency against a real Redis", () => {
  it("accepts an eventId exactly once per project", async () => {
    expect(await claimEventId(redis, "p1", "evt-1")).toBe(true);
    expect(await claimEventId(redis, "p1", "evt-1")).toBe(false);
  });

  it("does not cross-contaminate the same eventId across different projects", async () => {
    expect(await claimEventId(redis, "p1", "evt-1")).toBe(true);
    expect(await claimEventId(redis, "p2", "evt-1")).toBe(true);
  });
});