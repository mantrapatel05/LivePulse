const { computeDrift } = require("../../src/shared/insights/engagementDrift");

const defaults = {
  ENGAGEMENT_MIN_PREV_SESSIONS: process.env.ENGAGEMENT_MIN_PREV_SESSIONS,
  ENGAGEMENT_MIN_PAGE_VIEWS: process.env.ENGAGEMENT_MIN_PAGE_VIEWS,
  ENGAGEMENT_WATCH_PCT: process.env.ENGAGEMENT_WATCH_PCT,
  ENGAGEMENT_DROP_PCT: process.env.ENGAGEMENT_DROP_PCT,
};

const window = (overrides = {}) => ({
  sessions: 100,
  events: 1000,
  errors: 10,
  rage_clicks: 5,
  avg_engaged_seconds: 30,
  ...overrides,
});

beforeEach(() => {
  process.env.ENGAGEMENT_MIN_PREV_SESSIONS = "30";
  process.env.ENGAGEMENT_MIN_PAGE_VIEWS = "20";
  process.env.ENGAGEMENT_WATCH_PCT = "-20";
  process.env.ENGAGEMENT_DROP_PCT = "-40";
});

afterAll(() => {
  for (const [name, value] of Object.entries(defaults)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("computeDrift", () => {
  it("returns insufficient_data below the prior-window minimum without percentages", () => {
    const result = computeDrift({ cur: window(), prev: window({ sessions: 29 }), pages: [] });
    expect(result.status).toBe("insufficient_data");
    expect(result.metrics).toEqual([]);
    expect(result.topDecliners).toEqual([]);
    expect(result.summary).toMatch(/at least 30 sessions/);
    expect(result.summary).not.toContain("%");
  });

  it("returns ok for stable activity", () => {
    expect(computeDrift({ cur: window(), prev: window(), pages: [] }).status).toBe("ok");
  });

  it("applies the configured watch and drop session thresholds", () => {
    const watch = computeDrift({ cur: window({ sessions: 80 }), prev: window(), pages: [] });
    const drop = computeDrift({ cur: window({ sessions: 60 }), prev: window(), pages: [] });
    expect(watch.status).toBe("watch");
    expect(watch.metrics.find((metric) => metric.name === "sessions").deltaPct).toBe(-20);
    expect(drop.status).toBe("drop");
  });

  it("sets watch when relative error rate increases by more than 50 percent", () => {
    const result = computeDrift({
      cur: window({ errors: 20 }),
      prev: window({ errors: 10 }),
      pages: [],
    });
    expect(result.status).toBe("watch");
    expect(result.metrics.find((metric) => metric.name === "error_rate").deltaPct).toBe(100);
  });

  it("does not emit infinite or NaN percentages when previous metrics are zero", () => {
    const result = computeDrift({
      cur: window({ rage_clicks: 2, avg_engaged_seconds: 10 }),
      prev: window({ rage_clicks: 0, avg_engaged_seconds: 0, errors: 0 }),
      pages: [{ path: "/new", cur: 10, prev: 0 }],
    });
    expect(result.metrics.find((metric) => metric.name === "rage_clicks").deltaPct).toBeNull();
    expect(result.metrics.find((metric) => metric.name === "avg_engaged_seconds").deltaPct).toBeNull();
    expect(result.metrics.find((metric) => metric.name === "error_rate").deltaPct).toBeNull();
    for (const metric of result.metrics) {
      expect(metric.deltaPct === null || Number.isFinite(metric.deltaPct)).toBe(true);
    }
    expect(result.topDecliners).toEqual([]);
  });

  it("normalizes malformed numeric values without leaking NaN into the result", () => {
    const result = computeDrift({
      cur: window({ sessions: Number.NaN, errors: "not-a-number", events: Infinity }),
      prev: window(),
      pages: [{ path: "/bad", cur: Number.NaN, prev: Infinity }],
    });
    expect(result.status).toBe("drop");
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it("orders page decliners worst first and filters low-volume pages", () => {
    const result = computeDrift({
      cur: window({ sessions: 60 }),
      prev: window(),
      pages: [
        { path: "/a", cur: 50, prev: 100 },
        { path: "/b", cur: 10, prev: 100 },
        { path: "/small", cur: 0, prev: 19 },
      ],
    });
    expect(result.topDecliners.map((page) => page.path)).toEqual(["/b", "/a"]);
  });

  it("returns no more than five decliners", () => {
    const pages = Array.from({ length: 8 }, (_, index) => ({
      path: `/page-${index}`,
      cur: index,
      prev: 100,
    }));
    const result = computeDrift({ cur: window(), prev: window(), pages });
    expect(result.topDecliners).toHaveLength(5);
  });
});
