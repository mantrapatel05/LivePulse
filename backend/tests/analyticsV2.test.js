let server;
let baseUrl;
const request = {
  get: async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, body: await response.json() };
  },
};

let mockBackendMode = "clickhouse";
const mockQueryRows = new Map();
const mockRunQuery = jest.fn(async ({ query, query_params }) => {
  if (query === "timeline-events") {
    return mockQueryRows.get("timeline") || [];
  }
  if (query === "summary") return mockQueryRows.get("default") || [];
  return mockQueryRows.get(query_params.from ? "range" : "default") || [];
});

jest.mock("../src/middleware/supabaseAuth", () => ({
  requireDashboardAuth: (req, _res, next) => {
    req.user = { id: "v2-test-user" };
    next();
  },
}));
jest.mock("../src/middleware/projectOwnership", () => ({
  requireProjectOwnership: (req, _res, next) => {
    req.project = { _id: req.params.projectId, analyticsBackend: mockBackendMode };
    next();
  },
}));
jest.mock("../src/middleware/dashboardRateLimit", () => ({
  dashboardRateLimit: (_req, _res, next) => next(),
}));
jest.mock("../src/shared/analyticsQueries", () => ({
  buildOverviewQuery: jest.fn((params) => ({ query: "overview", query_params: params })),
  buildTimeseriesQuery: jest.fn((params) => ({ query: "timeseries", query_params: params })),
  buildTopPagesQuery: jest.fn((params) => ({ query: "top-pages", query_params: params })),
  buildEventBreakdownQuery: jest.fn((params) => ({ query: "breakdown", query_params: params })),
  buildErrorClustersRangeQuery: jest.fn((params) => ({ query: "errors", query_params: params })),
  buildHistoricalSessionsQuery: jest.fn((params) => ({ query: "historical", query_params: params })),
  buildSessionSummaryQuery: jest.fn((params) => ({ query: "summary", query_params: params })),
  buildSessionTimelineEventsQuery: jest.fn((params) => ({ query: "timeline-events", query_params: params })),
  runQuery: (...args) => mockRunQuery(...args),
}));
jest.mock("../src/shared/redisClient", () => ({
  getRedisClient: () => ({}),
  checkRedisReady: jest.fn().mockResolvedValue(true),
}));
jest.mock("../src/shared/clickhouseClient", () => ({ checkClickhouseReady: jest.fn().mockResolvedValue(true) }));
jest.mock("../src/shared/redisStream", () => ({ pendingCount: jest.fn().mockResolvedValue(3) }));
jest.mock("../src/shared/activeSessionState", () => ({
  activeCount: jest.fn().mockResolvedValue(2),
  listActiveSessions: jest.fn().mockResolvedValue([{ sessionId: "live-1", lastSeenAt: 1, startedAt: 0 }]),
}));

const app = require("../src/app");
const { buildErrorClustersRangeQuery } = require("../src/shared/analyticsQueries");

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

const project = "507f1f77bcf86cd799439011";
const range = "?from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-02T00%3A00%3A00.000Z&timezone=UTC";

beforeEach(() => {
  mockBackendMode = "clickhouse";
  mockQueryRows.clear();
  mockRunQuery.mockClear();
});

describe("V2 analytics API", () => {
  it("serves the frontend overview envelope and converts ClickHouse numbers", async () => {
    mockQueryRows.set("range", [{ total_events: "17", unique_visitors: "4", errors: "2", avg_engaged_seconds: "6.5" }]);
    const res = await request.get(`/api/v2/projects/${project}/overview${range}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ totalEvents: 17, uniqueVisitors: 4, errors: 2, avgEngagedSeconds: 6.5, activeNow: 2 });
    expect(res.body.generatedAt).toBeTruthy();
    expect(res.body.range).toMatchObject({ timezone: "UTC" });
  });

  it("registers and shapes all range-based dashboard reads", async () => {
    mockQueryRows.set("range", [{ bucket: "2026-01-01 00:00:00", count: "9", path: "/", views: "7", sessions: "3", event_type: "page_view", signature: "Error #", message: "Error 42", occurrences: "2", affected_sessions: "1", last_seen: "2026-01-01 01:00:00" }]);
    const paths = ["timeseries", "top-pages", "event-breakdown", "error-clusters"];
    for (const path of paths) {
      const res = await request.get(`/api/v2/projects/${project}/${path}${range}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.range.from).toBe("2026-01-01T00:00:00.000Z");
    }
    expect(buildErrorClustersRangeQuery).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it("serves live and historical sessions, timeline, and health in the declared shapes", async () => {
    mockQueryRows.set("range", [{ session_id: "s1", started_at: "2026-01-01 00:00:00", last_seen_at: "2026-01-01 00:01:00", events: "4", errors: "1", entry_url: "/", exit_url: "/done", engaged_seconds: "12" }]);
    mockQueryRows.set("default", [{ started_at: "2026-01-01 00:00:00", last_seen_at: "2026-01-01 00:01:00", events: "4", errors: "1", entry_url: "/", exit_url: "/done", engaged_seconds: "12" }]);
    mockQueryRows.set("timeline", [{ event_id: "e1", event_type: "page_view", url: "/", properties: "{}", occurred_at: "2026-01-01 00:00:00" }]);

    const active = await request.get(`/api/v2/projects/${project}/sessions?state=active`);
    expect(active.status).toBe(200);
    expect(active.body.data[0].sessionId).toBe("live-1");

    const historical = await request.get(`/api/v2/projects/${project}/sessions?state=historical&${range.slice(1)}`);
    expect(historical.status).toBe(200);
    expect(historical.body.data[0]).toMatchObject({ session_id: "s1", events: 4, errors: 1 });

    const timeline = await request.get(`/api/v2/projects/${project}/sessions/s1/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.data).toMatchObject({ sessionId: "s1", eventCount: 4, events: [{ event_id: "e1" }] });

    const health = await request.get(`/api/v2/projects/${project}/health`);
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ analyticsBackend: "clickhouse", redisOk: true, clickhouseOk: true, streamPendingCountProcessWide: 3, liveNow: 2 });
  });

  it("rejects invalid ranges, interval values, and migration modes", async () => {
    const invalidRange = await request.get(`/api/v2/projects/${project}/overview?from=nope&to=2026-01-02`);
    expect(invalidRange.status).toBe(400);
    const invalidInterval = await request.get(`/api/v2/projects/${project}/timeseries${range}&interval=week`);
    expect(invalidInterval.status).toBe(400);
    mockBackendMode = "dual";
    const gated = await request.get(`/api/v2/projects/${project}/overview${range}`);
    expect(gated.status).toBe(409);
    expect(gated.body.message).toMatch(/migrated to ClickHouse/);
  });

  it("returns JSON for unexpected ClickHouse failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("database detail should not be exposed"));
    const res = await request.get(`/api/v2/projects/${project}/overview${range}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error." });
  });
});
