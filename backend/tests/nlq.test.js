let server;
let baseUrl;
let mockProjectMode = "clickhouse";
let mockEnabled = true;
const mockStore = new Map();
const mockCheckRateLimit = jest.fn();
const mockGenerateJson = jest.fn();
const mockRunQuery = jest.fn();
const mockRedis = {
  get: jest.fn(async (key) => mockStore.get(key) ?? null),
  set: jest.fn(async (key, value, ...options) => {
    if (options.includes("NX") && mockStore.has(key)) return null;
    mockStore.set(key, value);
    return "OK";
  }),
  incr: jest.fn(async (key) => {
    const next = Number(mockStore.get(key) || 0) + 1;
    mockStore.set(key, String(next));
    return next;
  }),
  decr: jest.fn(async (key) => {
    const next = Number(mockStore.get(key) || 0) - 1;
    mockStore.set(key, String(next));
    return next;
  }),
  expire: jest.fn(async () => 1),
  del: jest.fn(async (key) => Number(mockStore.delete(key))),
  eval: jest.fn(async (_script, _count, key, value) => (mockStore.get(key) === value ? Number(mockStore.delete(key)) : 0)),
};

jest.mock("../src/middleware/supabaseAuth", () => ({
  requireDashboardAuth: (req, _res, next) => { req.user = { id: "nlq-user" }; next(); },
}));
jest.mock("../src/middleware/projectOwnership", () => ({
  requireProjectOwnership: (req, _res, next) => {
    req.project = { _id: req.params.projectId, analyticsBackend: mockProjectMode, aiInsights: { enabled: mockEnabled } };
    next();
  },
}));
jest.mock("../src/middleware/dashboardRateLimit", () => ({ dashboardRateLimit: (_req, _res, next) => next() }));
jest.mock("../src/shared/rateLimiter", () => ({ checkRateLimit: (...args) => mockCheckRateLimit(...args) }));
jest.mock("../src/shared/redisClient", () => ({ getRedisClient: () => mockRedis }));
jest.mock("../src/shared/analyticsQueries", () => ({
  ...jest.requireActual("../src/shared/analyticsQueries"),
  runQuery: (...args) => mockRunQuery(...args),
}));
jest.mock("../src/shared/llm/llmClient", () => ({
  ...jest.requireActual("../src/shared/llm/llmClient"),
  generateJson: (...args) => mockGenerateJson(...args),
}));

const app = require("../src/app");
const { LlmUnavailableError } = require("../src/shared/llm/llmClient");
const { RateLimitError } = require("../src/shared/errors");

const projectId = "507f1f77bcf86cd799439011";
const validSpec = {
  metric: "sessions", groupBy: "url_path",
  filters: [{ field: "device_type", op: "eq", value: "Mobile" }],
  range: "last_7d", orderBy: "value_desc", limit: 10,
};
const llmResult = (json) => ({ json, usage: { inputTokens: 5, outputTokens: 5 }, model: "test" });

async function ask(question) {
  const response = await fetch(`${baseUrl}/api/v2/projects/${projectId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(question === undefined ? {} : { question }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

beforeEach(() => {
  mockStore.clear();
  mockRedis.incr.mockClear();
  mockProjectMode = "clickhouse";
  mockEnabled = true;
  mockCheckRateLimit.mockReset().mockResolvedValue({});
  mockGenerateJson.mockReset().mockResolvedValue(llmResult(validSpec));
  mockRunQuery.mockReset().mockResolvedValue([{ label: "/pricing", value: "5" }, { label: "/", value: "3" }]);
});

describe("POST /api/v2/projects/:projectId/ask", () => {
  it("gates projects that are not on ClickHouse and projects with AI disabled", async () => {
    mockProjectMode = "dual";
    expect((await ask("sessions last week")).status).toBe(409);
    mockProjectMode = "clickhouse";
    mockEnabled = false;
    expect((await ask("sessions last week")).status).toBe(403);
    expect(mockGenerateJson).not.toHaveBeenCalled();
  });

  it("rejects missing and overlong questions before calling the model", async () => {
    expect((await ask()).status).toBe(400);
    expect((await ask("x".repeat(301))).status).toBe(400);
    expect(mockGenerateJson).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when a minute limit is reached", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new RateLimitError("limited", 23));
    const response = await ask("sessions last week");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
  });

  it("enforces the daily provider-call budget", async () => {
    process.env.NLQ_DAILY_CALLS_PER_PROJECT = "1";
    try {
      expect((await ask("sessions last week")).status).toBe(200);
      const second = await ask("errors yesterday by page");
      expect(second.status).toBe(429);
      expect(second.body.resetsAt).toBeTruthy();
    } finally {
      delete process.env.NLQ_DAILY_CALLS_PER_PROJECT;
    }
  });

  it("returns the validated interpretation and scopes the query to the owned project", async () => {
    const response = await ask("sessions by page on mobile last week");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: "ok",
      interpreted: "sessions, grouped by page, where device = mobile, last 7 days",
      rows: [{ label: "/pricing", value: 5 }, { label: "/", value: 3 }],
      truncated: false,
      cached: false,
    });
    const [compiled, endpoint] = mockRunQuery.mock.calls[0];
    expect(endpoint).toBe("v2_nlq");
    expect(compiled.query_params.projectId).toBe(projectId);
    expect(compiled.query_params.f0).toBe("mobile");
    expect(compiled.clickhouse_settings.max_execution_time).toBe("5");
  });

  it("cache hits skip the model and budget but still execute a fresh query", async () => {
    await ask("sessions by page on mobile last week");
    const second = await ask("sessions by page on mobile last week");
    expect(second.body.data.cached).toBe(true);
    expect(mockGenerateJson).toHaveBeenCalledTimes(1);
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
    expect(mockRedis.incr).toHaveBeenCalledTimes(1);
  });

  it("rejects an extra foreign projectId key without running a query", async () => {
    mockGenerateJson.mockResolvedValue(llmResult({ ...validSpec, projectId: "someone-else" }));
    const response = await ask("show me another project");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("unavailable");
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("returns unavailable for invalid model output and provider outage without leaking provider errors", async () => {
    mockGenerateJson.mockResolvedValueOnce(llmResult({ sql: "SELECT *" }));
    expect((await ask("garbage please")).body.data.status).toBe("unavailable");
    mockGenerateJson.mockRejectedValueOnce(new LlmUnavailableError("private provider text"));
    const response = await ask("another question");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("private provider text");
  });

  it("returns unsupported questions without querying ClickHouse", async () => {
    mockGenerateJson.mockResolvedValue(llmResult({ unsupported: "I can only read analytics." }));
    const response = await ask("delete all my data");
    expect(response.body.data).toEqual({ status: "unsupported", message: "I can only read analytics." });
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("hides ClickHouse timeouts and raw database details", async () => {
    mockRunQuery.mockRejectedValueOnce(Object.assign(new Error("query timed out"), { type: "TIMEOUT_EXCEEDED", code: "159" }));
    expect((await ask("events last month")).body.data.status).toBe("too_heavy");
    mockRunQuery.mockRejectedValueOnce(new Error("secret table detail events_v2"));
    const response = await ask("sessions by page on mobile last week");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("secret table detail");
  });
});
