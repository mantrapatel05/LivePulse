let server;
let baseUrl;
let mockBackendMode = "clickhouse";
const mockQueryRows = new Map();
const mockRedisStore = new Map();
const mockRunQuery = jest.fn();

jest.mock("../src/middleware/supabaseAuth", () => ({
  requireDashboardAuth: (req, _res, next) => {
    req.user = { id: "drift-test-user" };
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
  buildEngagementWindowQuery: jest.fn((params) => ({ query: "engagement-window", query_params: params })),
  buildPageDeltaQuery: jest.fn((params) => ({ query: "page-delta", query_params: params })),
  buildEventBreakdownQuery: jest.fn((params) => ({ query: "breakdown", query_params: params })),
  buildErrorClustersRangeQuery: jest.fn((params) => ({ query: "errors", query_params: params })),
  buildHistoricalSessionsQuery: jest.fn((params) => ({ query: "historical", query_params: params })),
  buildSessionSummaryQuery: jest.fn((params) => ({ query: "summary", query_params: params })),
  buildSessionTimelineEventsQuery: jest.fn((params) => ({ query: "timeline", query_params: params })),
  buildErrorClusterInsightQuery: jest.fn((params) => ({ query: "cluster", query_params: params })),
  buildErrorClusterRepresentativeSessionsQuery: jest.fn((params) => ({ query: "representatives", query_params: params })),
  runQuery: (...args) => mockRunQuery(...args),
}));
jest.mock("../src/shared/redisClient", () => ({
  getRedisClient: () => ({
    get: async (key) => mockRedisStore.get(key) ?? null,
    set: async (key, value, ...args) => {
      mockRedisStore.set(key, value);
      mockRedisStore.set(`${key}:ttl`, args[1]);
      return "OK";
    },
    del: async (key) => Number(mockRedisStore.delete(key)),
  }),
  checkRedisReady: jest.fn().mockResolvedValue(true),
}));
jest.mock("../src/shared/clickhouseClient", () => ({
  checkClickhouseReady: jest.fn().mockResolvedValue(true),
}));
jest.mock("../src/shared/redisStream", () => ({ pendingCount: jest.fn().mockResolvedValue(0) }));
jest.mock("../src/shared/activeSessionState", () => ({
  activeCount: jest.fn().mockResolvedValue(0),
  listActiveSessions: jest.fn().mockResolvedValue([]),
}));

const app = require("../src/app");
const projectId = "507f1f77bcf86cd799439011";

const request = async (query = "") => {
  const response = await fetch(`${baseUrl}/api/v2/projects/${projectId}/engagement-drift${query}`);
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  ),
);

beforeEach(() => {
  mockBackendMode = "clickhouse";
  mockQueryRows.clear();
  mockRedisStore.clear();
  mockRunQuery.mockReset().mockImplementation(async ({ query }) => mockQueryRows.get(query) || []);
});

describe("V2 engagement drift API", () => {
  it("returns 409 for a project not cut over to ClickHouse", async () => {
    mockBackendMode = "dual";
    const response = await request();
    expect(response.status).toBe(409);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("returns cached data without querying ClickHouse again", async () => {
    const cached = {
      drift: {
        status: "watch",
        metrics: [],
        topDecliners: [],
        summary: "Sessions down 25% vs the previous 7 days.",
      },
      range: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-15T00:00:00.000Z", timezone: "UTC" },
    };
    mockRedisStore.set(`drift:v1:${projectId}`, JSON.stringify(cached));

    const response = await request();

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ ...cached.drift, cached: true });
    expect(response.body.range).toEqual(cached.range);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("returns deterministic metrics and page declines for server-side rolling windows", async () => {
    const startedAt = Date.now();
    mockRunQuery
      .mockResolvedValueOnce([{ sessions: "50", events: "500", errors: "10", rage_clicks: "4", avg_engaged_seconds: "20" }])
      .mockResolvedValueOnce([{ sessions: "100", events: "1000", errors: "10", rage_clicks: "5", avg_engaged_seconds: "30" }])
      .mockResolvedValueOnce([
        { path: "/checkout", cur: "10", prev: "100" },
        { path: "/pricing", cur: "50", prev: "100" },
      ]);

    const response = await request("?from=2000-01-01&to=2000-01-02");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: "drop",
      summary: expect.stringContaining("Sessions down 50%"),
      cached: false,
      topDecliners: [
        { path: "/checkout", cur: 10, prev: 100, deltaPct: -90 },
        { path: "/pricing", cur: 50, prev: 100, deltaPct: -50 },
      ],
    });
    expect(response.body.data.metrics.find((metric) => metric.name === "sessions")).toEqual({
      name: "sessions",
      cur: 50,
      prev: 100,
      deltaPct: -50,
    });
    expect(Date.parse(response.body.range.to)).toBeGreaterThanOrEqual(startedAt);
    expect(response.body.range.timezone).toBe("UTC");
    expect(mockRunQuery).toHaveBeenCalledTimes(3);
    expect(mockRunQuery.mock.calls[0][0].query_params.from).not.toBe("2000-01-01");
    expect(mockRedisStore.get(`drift:v1:${projectId}:ttl`)).toBe(300);
  });
});
