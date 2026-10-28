let server;
let baseUrl;
let mockProjectMode = "clickhouse";
let mockProjectEnabled = true;
let mockConfigured = true;
const mockRedisStore = new Map();
const mockCheckRateLimit = jest.fn(async () => ({ remaining: 9 }));
const mockGenerateJson = jest.fn();
const mockRunQuery = jest.fn();
const mockRedis = {
  get: jest.fn(async (key) => mockRedisStore.get(key) ?? null),
  set: jest.fn(async (key, value, ...options) => {
    if (options.includes("NX") && mockRedisStore.has(key)) return null;
    mockRedisStore.set(key, value);
    return "OK";
  }),
  incr: jest.fn(async (key) => {
    const next = Number(mockRedisStore.get(key) || 0) + 1;
    mockRedisStore.set(key, String(next));
    return next;
  }),
  decr: jest.fn(async (key) => {
    const next = Number(mockRedisStore.get(key) || 0) - 1;
    mockRedisStore.set(key, String(next));
    return next;
  }),
  expire: jest.fn(async () => 1),
  del: jest.fn(async (key) => Number(mockRedisStore.delete(key))),
  eval: jest.fn(async (_script, _count, key, value) => {
    if (mockRedisStore.get(key) === value) return Number(mockRedisStore.delete(key));
    return 0;
  }),
};

jest.mock("../src/middleware/supabaseAuth", () => ({
  requireDashboardAuth: (req, _res, next) => { req.user = { id: "insight-test-user" }; next(); },
}));
jest.mock("../src/middleware/projectOwnership", () => ({
  requireProjectOwnership: (req, _res, next) => {
    req.project = {
      _id: req.params.projectId,
      analyticsBackend: mockProjectMode,
      aiInsights: { enabled: mockProjectEnabled },
      set: jest.fn(function set(path, value) { this.aiInsights.enabled = value; }),
      save: jest.fn(async function save() { return this; }),
    };
    next();
  },
}));
jest.mock("../src/middleware/dashboardRateLimit", () => ({ dashboardRateLimit: (_req, _res, next) => next() }));
jest.mock("../src/shared/rateLimiter", () => ({ checkRateLimit: (...args) => mockCheckRateLimit(...args) }));
jest.mock("../src/shared/redisClient", () => ({ getRedisClient: () => mockRedis }));
jest.mock("../src/shared/analyticsQueries", () => {
  const actual = jest.requireActual("../src/shared/analyticsQueries");
  return {
    ...actual,
    buildSessionSummaryQuery: jest.fn((params) => ({ query: "session-summary", query_params: params })),
    buildSessionTimelineEventsQuery: jest.fn((params) => ({ query: "session-timeline", query_params: params })),
    buildErrorClusterInsightQuery: jest.fn((params) => ({ query: "error-cluster", query_params: params })),
    buildErrorClusterRepresentativeSessionsQuery: jest.fn((params) => ({ query: "representative-sessions", query_params: params })),
    runQuery: (...args) => mockRunQuery(...args),
  };
});
jest.mock("../src/shared/llm/llmClient", () => {
  const actual = jest.requireActual("../src/shared/llm/llmClient");
  return { ...actual, generateJson: (...args) => mockGenerateJson(...args), isConfigured: () => mockConfigured };
});

const app = require("../src/app");
const { LlmUnavailableError } = require("../src/shared/llm/llmClient");
const { RateLimitError } = require("../src/shared/errors");

const projectId = "507f1f77bcf86cd799439011";
const goodSessionInsight = {
  headline: "The visitor reached checkout",
  narrative: "A product page led to checkout, with one error before exit.",
  outcome: "frustrated",
  friction: [{ kind: "error", note: "A checkout error occurred.", evidenceIds: ["e2"] }],
  suggestedActions: ["Inspect the checkout error."],
};
const goodErrorInsight = {
  summary: "This error repeats across sessions.",
  likelyCause: "Likely a request parsing issue.",
  userImpact: "Some sessions may fail to complete the page action.",
  suggestedFix: "Inspect the request parser and its inputs.",
  confidence: "low",
};

async function post(path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

beforeEach(() => {
  mockRedisStore.clear();
  mockProjectMode = "clickhouse";
  mockProjectEnabled = true;
  mockConfigured = true;
  mockCheckRateLimit.mockReset().mockResolvedValue({ remaining: 9 });
  mockGenerateJson.mockReset().mockResolvedValue({ json: goodSessionInsight, usage: { inputTokens: 12, outputTokens: 8 }, model: "test-model" });
  mockRunQuery.mockReset().mockImplementation(async (query) => {
    if (query.query === "session-summary") { const sessionId = query.query_params.sessionId; return [{ started_at: "2026-10-25 10:00:00", last_seen_at: sessionId === "session-2" ? "2026-10-25 10:01:30" : "2026-10-25 10:00:30", events: 2, errors: 1, engaged_seconds: 5, entry_url: "https://site.test/start", exit_url: sessionId === "session-2" ? `https://site.test/checkout/${sessionId}` : "https://site.test/checkout" }]; }
    if (query.query === "session-timeline") { const prefix = query.query_params.sessionId === "session-copy" ? "copy" : "real"; return [
      { event_id: `${prefix}-1`, event_type: "page_view", url: "https://site.test/start", occurred_at: "2026-10-25 10:00:00", properties: "{}" },
      { event_id: `${prefix}-2`, event_type: "error", url: "https://site.test/checkout", occurred_at: "2026-10-25 10:00:30", properties: JSON.stringify({ message: "Checkout failed" }) },
    ]; }
    if (query.query === "error-cluster") return [{ signature: "TypeError #", message: "TypeError: failed", occurrences: 2, affected_sessions: 2, last_seen: "2026-10-25 10:00:30" }];
    if (query.query === "representative-sessions") return [];
    return [];
  });
});

describe("AI insight API", () => {
  const sessionPath = `/api/v2/projects/${projectId}/sessions/session-1/insight`;

  it("returns 409 before generation when the project has not cut over to ClickHouse", async () => {
    mockProjectMode = "dual";
    expect((await post(sessionPath)).status).toBe(409);
    expect(mockGenerateJson).not.toHaveBeenCalled();
  });

  it("returns 403 when the project opted out", async () => {
    mockProjectEnabled = false;
    expect((await post(sessionPath)).status).toBe(403);
  });

  it("returns a Retry-After 429 when a rate limit is exceeded", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new RateLimitError("rate limited", 23));
    const response = await post(sessionPath);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
  });

  it("enforces the daily project budget", async () => {
    process.env.AI_INSIGHT_DAILY_CALLS_PER_PROJECT = "1";
    try {
      expect((await post(sessionPath)).status).toBe(200);
      const other = await post(`/api/v2/projects/${projectId}/sessions/session-2/insight`);
      expect(other.status).toBe(429);
      expect(other.body.resetsAt).toBeTruthy();
    } finally {
      delete process.env.AI_INSIGHT_DAILY_CALLS_PER_PROJECT;
    }
  });

  it("serves cached insights without consuming another daily call", async () => {
    const first = await post(sessionPath);
    const budgetKey = [...mockRedisStore.keys()].find((key) => key.startsWith("ai:budget:"));
    const spent = mockRedisStore.get(budgetKey);
    const second = await post(sessionPath);
    expect(first.status).toBe(200);
    expect(second.body.data.cached).toBe(true);
    expect(mockRedisStore.get(budgetKey)).toBe(spent);
    expect(mockGenerateJson).toHaveBeenCalledTimes(1);
  });

  it("rebinds cached evidence references to the requesting session's event ids", async () => {
    await post(sessionPath);
    const copiedSession = await post(`/api/v2/projects/${projectId}/sessions/session-copy/insight`);
    expect(copiedSession.body.data.cached).toBe(true);
    expect(copiedSession.body.data.insight.friction[0].eventIds).toEqual(["copy-2"]);
  });

  it("single-flights concurrent duplicate requests", async () => {
    mockGenerateJson.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { json: goodSessionInsight, usage: { inputTokens: 12, outputTokens: 8 }, model: "test-model" };
    });
    const responses = await Promise.all([post(sessionPath), post(sessionPath)]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(mockGenerateJson).toHaveBeenCalledTimes(1);
  });

  it("returns a deterministic degraded result and never exposes provider errors", async () => {
    mockGenerateJson.mockRejectedValue(new LlmUnavailableError("private provider error text"));
    const response = await post(sessionPath);
    expect(response.status).toBe(200);
    expect(response.body.data.degraded).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("private provider error text");
  });

  it("serves an error-cluster explanation for the requested range", async () => {
    mockGenerateJson.mockResolvedValue({ json: goodErrorInsight, usage: { inputTokens: 10, outputTokens: 8 }, model: "test-model" });
    const response = await post(`/api/v2/projects/${projectId}/error-clusters/insight`, {
      signature: "TypeError #",
      from: "2026-10-25T09:00:00Z",
      to: "2026-10-25T11:00:00Z",
      timezone: "UTC",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.insight.likelyCause).toMatch(/likely/i);
  });

  it("updates the project opt-in through the owner-protected route", async () => {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/ai-insights`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).project.aiInsights.enabled).toBe(false);
  });
});
