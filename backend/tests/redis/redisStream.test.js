const { createRedisClient } = require("../../src/shared/redisClient");
const stream = require("../../src/shared/redisStream");

let redis;

beforeAll(() => {
  redis = createRedisClient("test");
});

beforeEach(async () => {
  await redis.flushall();
});

afterAll(async () => {
  await redis.quit();
});

describe("redisStream against a real Redis", () => {
  it("carries W3C trace context through the stream consumer read", async () => {
    await stream.publishEvent(redis, {
      projectId: "p1",
      event: { i: 1 },
      correlationId: "trace-test",
      traceContext: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        tracestate: "vendor=value",
      },
    });

    const [entry] = await stream.readBatch(redis, "trace-consumer", { count: 1, blockMs: 50 });
    expect(entry.traceContext).toEqual({
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      tracestate: "vendor=value",
    });
  });

  it("publishes events and a consumer group reads them exactly once as 'new'", async () => {
    for (let i = 0; i < 3; i++) {
      await stream.publishEvent(redis, { projectId: "p1", event: { i }, correlationId: `c${i}` });
    }

    const batch = await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 });
    expect(batch).toHaveLength(3);
    expect(batch.map((e) => e.event)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 } ]);

    const second = await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 });
    expect(second).toHaveLength(0);
  });

  it("reclaims entries abandoned by a crashed consumer and hands them to a new one", async () => {
    await stream.publishEvent(redis, { projectId: "p1", event: { x: 1 }, correlationId: "c1" });
    await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 }); // read, never ack (simulated crash)

    const reclaimed = await stream.reclaimStale(redis, "consumerB", { minIdleMs: 0, count: 10 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].event).toEqual({ x: 1 });
  });

  it("ack removes entries from pending", async () => {
    await stream.publishEvent(redis, { projectId: "p1", event: { x: 1 }, correlationId: "c1" });
    const batch = await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 });

    expect(await stream.pendingCount(redis)).toBe(1);
    await stream.ack(redis, batch.map((e) => e.id));
    expect(await stream.pendingCount(redis)).toBe(0);
  });

  it("dead-letters an entry after MAX_DELIVERY_ATTEMPTS reclaims and stops returning it as retryable", async () => {
    await stream.publishEvent(redis, { projectId: "p2", event: { poison: true }, correlationId: "cx" });
    await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 }); // read, never ack

    let lastRetryable = [];
    for (let attempt = 0; attempt < stream.MAX_DELIVERY_ATTEMPTS + 2; attempt++) {
      lastRetryable = await stream.reclaimStale(redis, `retry${attempt}`, { minIdleMs: 0, count: 10 });
    }
    expect(lastRetryable).toHaveLength(0);

    const dead = await redis.xrange(stream.DEAD_LETTER_STREAM_KEY, "-", "+");
    expect(dead).toHaveLength(1);
    expect(await stream.pendingCount(redis)).toBe(0);
  });

  it("keeps different projects' events independent within the same stream", async () => {
    await stream.publishEvent(redis, { projectId: "p1", event: { for: "p1" }, correlationId: "c1" });
    await stream.publishEvent(redis, { projectId: "p2", event: { for: "p2" }, correlationId: "c2" });

    const batch = await stream.readBatch(redis, "consumerA", { count: 10, blockMs: 50 });
    expect(batch.map((e) => e.projectId).sort()).toEqual(["p1", "p2"]);
  });
});
