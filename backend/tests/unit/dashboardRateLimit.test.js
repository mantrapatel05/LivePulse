const { RateLimitError } = require("../../src/shared/errors");

jest.mock("../../src/shared/rateLimiter", () => ({ checkRateLimit: jest.fn() }));
jest.mock("../../src/shared/redisClient", () => ({ getRedisClient: () => ({}) }));
jest.mock("../../src/services/geo", () => ({ getClientIp: () => "127.0.0.1" }));

const { checkRateLimit } = require("../../src/shared/rateLimiter");
const { dashboardRateLimit } = require("../../src/middleware/dashboardRateLimit");

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("dashboardRateLimit", () => {
  beforeEach(() => checkRateLimit.mockReset().mockResolvedValue({ count: 1 }));

  it("applies both per-user and per-IP limits", async () => {
    const req = { user: { id: "user-1" }, headers: {}, ip: "127.0.0.1" };
    const res = makeResponse();
    const next = jest.fn();

    await dashboardRateLimit(req, res, next);

    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(checkRateLimit.mock.calls.map(([_, options]) => options.scope)).toEqual(["dashboard_user", "dashboard_ip"]);
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 429 and Retry-After when a dashboard limit is exceeded", async () => {
    checkRateLimit.mockRejectedValueOnce(new RateLimitError("Rate limit exceeded for dashboard_user", 17));
    const res = makeResponse();

    await dashboardRateLimit({ user: { id: "user-1" }, headers: {}, ip: "127.0.0.1" }, res, jest.fn());

    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("17");
    expect(res.body.retryAfterSeconds).toBe(17);
  });
});
