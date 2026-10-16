jest.mock("../../src/models/Project");
const Project = require("../../src/models/Project");
const { createRedisClient } = require("../../src/shared/redisClient");
const { resolveApiKey, invalidateApiKeyCache } = require("../../src/shared/resolveApiKey");
const { generateApiKey, hashApiKey } = require("../../src/shared/apiKeyHash");

let redis;

beforeAll(() => {
  redis = createRedisClient("test-resolve");
});

beforeEach(async () => {
  await redis.flushall();
  jest.resetAllMocks();
});

afterAll(async () => {
  await redis.quit();
});

describe("resolveApiKey", () => {
  it("resolves a V2 hashed key via Mongo on a cold cache, then serves a snapshot from Redis with zero Mongo on the next call", async () => {
    const { plaintext, hash } = generateApiKey();
    const fakeProject = { _id: "proj1", apiKeyHash: hash, analyticsBackend: "dual" };
    Project.findOne.mockResolvedValue(fakeProject);
    Project.findById.mockResolvedValue(fakeProject);

    const first = await resolveApiKey(redis, plaintext);
    expect(first).toEqual({ _id: "proj1", analyticsBackend: "dual" });
    expect(Project.findOne).toHaveBeenCalledWith({ apiKeyHash: hash });

    // second call must hit the Redis snapshot -- NO Mongo at all, not even findById. That's the whole point.
    Project.findOne.mockClear();
    Project.findById.mockClear();
    const second = await resolveApiKey(redis, plaintext);
    expect(second).toEqual({ _id: "proj1", analyticsBackend: "dual" });
    expect(Project.findOne).not.toHaveBeenCalled();
    expect(Project.findById).not.toHaveBeenCalled(); // the whole point
  });

  it("migrates an old-format (bare id) cache entry to a snapshot without breaking auth", async () => {
    const { plaintext, hash } = generateApiKey();
    await redis.set(`apikey:${hash}`, "proj1", "EX", 60); // pre-snapshot format
    Project.findById.mockResolvedValue({ _id: "proj1", analyticsBackend: "clickhouse" });

    const project = await resolveApiKey(redis, plaintext);
    expect(project).toEqual({ _id: "proj1", analyticsBackend: "clickhouse" });
    // cache is now the new snapshot format
    expect(JSON.parse(await redis.get(`apikey:${hash}`))).toEqual({
      _id: "proj1",
      analyticsBackend: "clickhouse",
    });
  });

  it("falls back to a legacy plaintext match when there's no hash match", async () => {
    Project.findOne
      .mockResolvedValueOnce(null) // apiKeyHash miss
      .mockResolvedValueOnce({ _id: "legacy1", apiKey: "lp_old_plaintext_key", analyticsBackend: "mongo" }); // legacy hit

    const project = await resolveApiKey(redis, "lp_old_plaintext_key");
    expect(project).toEqual({ _id: "legacy1", analyticsBackend: "mongo" });
    expect(Project.findOne).toHaveBeenNthCalledWith(2, { apiKey: "lp_old_plaintext_key" });
  });

  it("returns null for an unknown key without throwing", async () => {
    Project.findOne.mockResolvedValue(null);
    expect(await resolveApiKey(redis, "lp_live_totally_made_up")).toBeNull();
  });

  it("rotation invalidation removes the old key from cache immediately", async () => {
    const { plaintext: oldPlain, hash: oldHash } = generateApiKey();
    Project.findOne.mockResolvedValue({ _id: "proj1", apiKeyHash: oldHash, analyticsBackend: "dual" });
    Project.findById.mockResolvedValue({ _id: "proj1", apiKeyHash: oldHash, analyticsBackend: "dual" });

    await resolveApiKey(redis, oldPlain); // primes the cache
    expect(JSON.parse(await redis.get(`apikey:${oldHash}`))).toEqual({
      _id: "proj1",
      analyticsBackend: "dual",
    });

    await invalidateApiKeyCache(redis, { hash: oldHash });
    expect(await redis.get(`apikey:${oldHash}`)).toBeNull();

    // After rotation, the old key matches neither the new hash nor any
    // legacy plaintext field — both lookup steps should miss.
    Project.findOne.mockResolvedValue(null);
    const afterRotation = await resolveApiKey(redis, oldPlain);
    expect(afterRotation).toBeNull();
  });

  it("hashing is one-directional in cache keys — the plaintext key never appears in Redis", async () => {
    const { plaintext, hash } = generateApiKey();
    Project.findOne.mockResolvedValue({ _id: "proj1", apiKeyHash: hash, analyticsBackend: "dual" });
    await resolveApiKey(redis, plaintext);

    const keys = await redis.keys("apikey:*");
    for (const k of keys) {
      expect(k).not.toContain(plaintext);
      const val = await redis.get(k);
      expect(val).not.toContain(plaintext);
    }
  });
});
