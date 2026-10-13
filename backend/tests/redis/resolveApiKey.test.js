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
  it("resolves a V2 hashed key via Mongo on a cold cache, then serves from Redis on the next call", async () => {
    const { plaintext, hash } = generateApiKey();
    const fakeProject = { _id: "proj1", apiKeyHash: hash };
    Project.findOne.mockResolvedValue(fakeProject);
    Project.findById.mockResolvedValue(fakeProject);

    const first = await resolveApiKey(redis, plaintext);
    expect(first).toBe(fakeProject);
    expect(Project.findOne).toHaveBeenCalledWith({ apiKeyHash: hash });

    // second call should hit the Redis cache -> findById, not findOne again
    Project.findOne.mockClear();
    const second = await resolveApiKey(redis, plaintext);
    expect(second).toBe(fakeProject);
    expect(Project.findOne).not.toHaveBeenCalled();
    expect(Project.findById).toHaveBeenCalledWith("proj1");
  });

  it("falls back to a legacy plaintext match when there's no hash match", async () => {
    Project.findOne
      .mockResolvedValueOnce(null) // apiKeyHash miss
      .mockResolvedValueOnce({ _id: "legacy1", apiKey: "lp_old_plaintext_key" }); // legacy hit

    const project = await resolveApiKey(redis, "lp_old_plaintext_key");
    expect(project).toEqual({ _id: "legacy1", apiKey: "lp_old_plaintext_key" });
    expect(Project.findOne).toHaveBeenNthCalledWith(2, { apiKey: "lp_old_plaintext_key" });
  });

  it("returns null for an unknown key without throwing", async () => {
    Project.findOne.mockResolvedValue(null);
    expect(await resolveApiKey(redis, "lp_live_totally_made_up")).toBeNull();
  });

  it("rotation invalidation removes the old key from cache immediately", async () => {
    const { plaintext: oldPlain, hash: oldHash } = generateApiKey();
    Project.findOne.mockResolvedValue({ _id: "proj1", apiKeyHash: oldHash });
    Project.findById.mockResolvedValue({ _id: "proj1", apiKeyHash: oldHash });

    await resolveApiKey(redis, oldPlain); // primes the cache
    expect(await redis.get(`apikey:${oldHash}`)).toBe("proj1");

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
    Project.findOne.mockResolvedValue({ _id: "proj1", apiKeyHash: hash });
    await resolveApiKey(redis, plaintext);

    const keys = await redis.keys("apikey:*");
    for (const k of keys) {
      expect(k).not.toContain(plaintext);
      const val = await redis.get(k);
      expect(val).not.toContain(plaintext);
    }
  });
});
