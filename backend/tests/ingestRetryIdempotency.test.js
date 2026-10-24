const mongoose = require("mongoose");
const Event = require("../src/models/Event");
const Session = require("../src/models/Session");
const { connect, closeDatabase, clearDatabase } = require("./helpers/testDb");

const mockState = {
  claims: new Set(),
  publishAttempts: 0,
  pipelineShouldFailOnce: true,
};

const mockRedis = {
  pipeline() {
    return {
      queuedCommands: 0,
      exec: async function exec() {
        mockState.publishAttempts += 1;
        if (mockState.pipelineShouldFailOnce) {
          mockState.pipelineShouldFailOnce = false;
          throw new Error("simulated Redis publish failure");
        }
        return Array.from({ length: this.queuedCommands }, () => [null, "OK"]);
      },
    };
  },
};

jest.doMock("../src/shared/redisClient", () => ({
  getRedisClient: () => mockRedis,
  closeRedisClient: async () => {},
}));
jest.doMock("../src/shared/idempotency", () => ({
  claimEventId: async (_redis, projectId, eventId) => {
    const key = `${projectId}:${eventId}`;
    if (mockState.claims.has(key)) return false;
    mockState.claims.add(key);
    return true;
  },
  claimEventIds: async (_redis, projectId, eventIds) =>
    eventIds.map((eventId) => {
      const key = `${projectId}:${eventId}`;
      if (mockState.claims.has(key)) return false;
      mockState.claims.add(key);
      return true;
    }),
  releaseEventId: async (_redis, projectId, eventId) => mockState.claims.delete(`${projectId}:${eventId}`),
  releaseEventIds: async (_redis, projectId, eventIds) => {
    eventIds.forEach((eventId) => mockState.claims.delete(`${projectId}:${eventId}`));
  },
}));
jest.doMock("../src/shared/redisStream", () => ({
  publishEvent: async () => {},
  queuePublish: (pipeline) => {
    pipeline.queuedCommands += 1;
  },
}));
jest.doMock("../src/shared/activeSessionState", () => ({
  touchSession: async () => {},
  queueSessionTouches: (pipeline) => {
    pipeline.queuedCommands += 1;
  },
}));
jest.doMock("../src/services/geo", () => ({
  getClientIp: () => "127.0.0.1",
  resolveGeo: () => ({ country: "US", city: "Test" }),
}));
jest.doMock("../src/services/userAgent", () => ({
  parseUserAgent: () => ({ deviceType: "desktop", browser: "test" }),
}));
jest.doMock("../src/shared/tracing", () => ({
  currentTraceContext: () => ({}),
  withSpan: (_name, _attributes, operation) => operation(),
}));

const { ingestBatch } = require("../src/shared/ingestPipeline");

beforeAll(async () => {
  await connect();
  await Event.createIndexes();
});

beforeEach(async () => {
  await clearDatabase();
  mockState.claims.clear();
  mockState.publishAttempts = 0;
  mockState.pipelineShouldFailOnce = true;
});

afterAll(closeDatabase);

it("does not duplicate Mongo events or session counts when Redis fails after the first Mongo write", async () => {
  const project = { _id: new mongoose.Types.ObjectId(), analyticsBackend: "dual" };
  const request = {
    id: "retry-idempotency-test",
    headers: { "user-agent": "test" },
    app: { get: () => null },
  };
  const rawEvents = [
    {
      eventId: "retry-event-1",
      sessionId: "retry-session",
      eventType: "page_view",
      url: "https://example.test/one",
      occurredAt: "2026-10-24T00:00:00.000Z",
    },
    {
      eventId: "retry-event-2",
      sessionId: "retry-session",
      eventType: "click",
      url: "https://example.test/two",
      occurredAt: "2026-10-24T00:00:01.000Z",
    },
  ];

  await expect(ingestBatch({ project, rawEvents, req: request })).rejects.toThrow("simulated Redis publish failure");
  expect(await Event.countDocuments({ projectId: project._id })).toBe(2);
  expect((await Session.findOne({ projectId: project._id, sessionId: "retry-session" })).eventCount).toBe(2);

  const retry = await ingestBatch({ project, rawEvents, req: request });

  expect(retry.accepted).toBe(2);
  expect(await Event.countDocuments({ projectId: project._id })).toBe(2);
  expect(await Event.distinct("eventId", { projectId: project._id })).toEqual(["retry-event-1", "retry-event-2"]);
  expect((await Session.findOne({ projectId: project._id, sessionId: "retry-session" })).eventCount).toBe(2);
  expect(mockState.publishAttempts).toBe(2);
});
