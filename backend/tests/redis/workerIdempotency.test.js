jest.mock("../../src/shared/clickhouseClient", () => {
  const actual = jest.requireActual("../../src/shared/clickhouseClient");
  return {
    ...actual,
    insertEvents: jest.fn().mockResolvedValue(),
  };
});

const { insertEvents } = require("../../src/shared/clickhouseClient");
const { createRedisClient } = require("../../src/shared/redisClient");
const { ensureConsumerGroup } = require("../../src/shared/redisStream");
const { processBatch } = require("../../worker");

let redis;

beforeAll(async () => {
  redis = createRedisClient("test-worker-idempotency");
});

beforeEach(async () => {
  await redis.flushall();
  await ensureConsumerGroup(redis);
  jest.clearAllMocks();
});

afterAll(async () => {
  await redis.quit();
});

describe("worker crash-then-reclaim idempotency against real Redis", () => {
  it("processes the exact same event twice with exactly one ClickHouse insert (crash-then-reclaim)", async () => {
    insertEvents.mockResolvedValue();

    const entry = {
      id: "1000-0",
      projectId: "proj-1",
      event: {
        eventId: "evt-crash-1",
        sessionId: "s1",
        eventType: "page_view",
        url: "https://example.com/checkout",
        occurredAt: "2026-10-13T14:00:00.000Z",
      },
    };

    // First attempt: succeeds, but simulated crash prevents ack
    await processBatch([entry], redis);
    expect(insertEvents).toHaveBeenCalledTimes(1);

    // Second attempt: entry is reclaimed by another consumer and reprocessed
    await processBatch([entry], redis);

    // Exactly one ClickHouse insert occurred across both executions
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });

  it("rolls back the claim if ClickHouse insert fails so retry can succeed", async () => {
    insertEvents.mockRejectedValueOnce(new Error("ClickHouse connection error"));

    const entry = {
      id: "2000-0",
      projectId: "proj-1",
      event: {
        eventId: "evt-retry-1",
        sessionId: "s2",
        eventType: "page_view",
        url: "https://example.com/pricing",
        occurredAt: "2026-10-13T14:00:00.000Z",
      },
    };

    // First attempt: insert fails
    await expect(processBatch([entry], redis)).rejects.toThrow("ClickHouse connection error");
    expect(insertEvents).toHaveBeenCalledTimes(1);

    // Second attempt: retry after ClickHouse is reachable again
    insertEvents.mockResolvedValueOnce();
    await processBatch([entry], redis);

    // The event was retried and successfully inserted on the second call
    expect(insertEvents).toHaveBeenCalledTimes(2);
  });
});
