const { requireMetricsAuth } = require("../../src/middleware/metricsAuth");

function makeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("requireMetricsAuth", () => {
  const originalToken = process.env.METRICS_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  afterAll(() => {
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("requires the configured bearer token", () => {
    process.env.METRICS_TOKEN = "test-token";
    const res = makeResponse();
    const next = jest.fn();
    requireMetricsAuth({ get: () => "Bearer wrong-token" }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a valid bearer token", () => {
    process.env.METRICS_TOKEN = "test-token";
    const next = jest.fn();
    requireMetricsAuth({ get: () => "Bearer test-token" }, makeResponse(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("fails closed in production when no token is configured", () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    const res = makeResponse();
    requireMetricsAuth({ get: () => "" }, res, jest.fn());
    expect(res.statusCode).toBe(503);
  });
});
