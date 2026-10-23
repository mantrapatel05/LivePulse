const { RateLimitError } = require("../../src/shared/errors");

jest.mock("../../src/shared/rateLimiter", () => ({ checkRateLimit: jest.fn() }));
jest.mock("../../src/shared/redisClient", () => ({ getRedisClient: () => ({}) }));
jest.mock("../../src/services/geo", () => ({ getClientIp: () => "1.1.1.1" }));

const { checkRateLimit } = require("../../src/shared/rateLimiter");
const { ingestRateLimit } = require("../../src/middleware/rateLimit");

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("ingestRateLimit per-session limit", () => {
  const req = {
    project: { _id: "p1" },
    body: { events: [{ sessionId: "s1" }] },
    headers: {},
    ip: "1.1.1.1",
  };

  beforeEach(() => checkRateLimit.mockReset().mockResolvedValue({ count: 1 }));

  it("applies a session limit scoped to the project", async () => {
    const next = jest.fn();
    await ingestRateLimit(req, makeResponse(), next);

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "session", key: "p1:s1" }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 429 and Retry-After when the session limit is exceeded", async () => {
    checkRateLimit
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new RateLimitError("Rate limit exceeded for session", 9));
    const res = makeResponse();

    await ingestRateLimit(req, res, jest.fn());

    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("9");
    expect(res.body.retryAfterSeconds).toBe(9);
  });
});
