describe("socket and HTTP CORS origin policy", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  let corsOrigin;

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = "production";
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example.test";
    ({ corsOrigin } = require("../../src/config/corsOrigin"));
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDashboardOrigin === undefined) delete process.env.DASHBOARD_ORIGIN;
    else process.env.DASHBOARD_ORIGIN = originalDashboardOrigin;
  });

  it("allows the configured dashboard origin and server-to-server requests", () => {
    const callback = jest.fn();
    corsOrigin("https://dashboard.example.test", callback);
    expect(callback).toHaveBeenCalledWith(null, true);
    const serverRequest = jest.fn();
    corsOrigin(undefined, serverRequest);
    expect(serverRequest).toHaveBeenCalledWith(null, true);
  });

  it("rejects arbitrary website origins in production", () => {
    const callback = jest.fn();
    corsOrigin("https://attacker.example", callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });
});
