process.env.DIGEST_SECRET = "test-secret-at-least-16-chars";
process.env.PUBLIC_BACKEND_URL = "http://api.test";

const { processProject } = require("../../src/shared/digest/runDigest");
const { buildDigest, groundingOk } = require("../../src/shared/digest/buildDigest");
const { signUnsubscribeToken, verifyUnsubscribeToken } = require("../../src/shared/digest/token");
const { logger } = require("../../src/shared/logger");

function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, value, ...args) {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) { return store.get(key) ?? null; },
    async del(key) { return Number(store.delete(key)); },
    async exists(key) { return Number(store.has(key)); },
    async incr(key) {
      const value = Number(store.get(key) || 0) + 1;
      store.set(key, String(value));
      return value;
    },
    async decr(key) {
      const value = Number(store.get(key) || 0) - 1;
      store.set(key, String(value));
      return value;
    },
    async expire() { return 1; },
    async eval(_script, _numKeys, key, value) {
      if (store.get(key) === value) { store.delete(key); return 1; }
      return 0;
    },
  };
}

const project = {
  _id: "507f1f77bcf86cd799439011",
  name: "Acme",
  analyticsBackend: "clickhouse",
  digest: { enabled: true, email: "a@b.com" },
  aiInsights: { enabled: false },
};

const queryRows = (events = 100) => async ({ query }) => {
  if (query.includes("uniqExact(session_id) AS sessions")) {
    return [{ sessions: events ? 100 : 0, events, errors: 1, rage_clicks: 0, avg_engaged_seconds: 20 }];
  }
  if (query.includes("countIf(occurred_at")) return [];
  if (query.includes("any(JSONExtractString")) {
    return [{ signature: "s", message: "TypeError", occurrences: 4, affected_sessions: 2 }];
  }
  return [{ path: "/pricing", views: 50, sessions: 20 }];
};

const dependencies = (overrides = {}) => ({
  redis: fakeRedis(),
  runQuery: queryRows(),
  sendEmail: jest.fn().mockResolvedValue(true),
  markSent: jest.fn().mockResolvedValue(),
  llmConfigured: false,
  ...overrides,
});

describe("weekly founder digest", () => {
  it("uses a Redis week claim to prevent two workers sending twice", async () => {
    const deps = dependencies();
    const results = await Promise.all([
      processProject(project, "2026-W44", deps),
      processProject(project, "2026-W44", deps),
    ]);
    expect(results.sort()).toEqual(["duplicate", "sent"]);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("releases a failed claim and retries successfully", async () => {
    const deps = dependencies();
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error("provider body"), { status: 500 }));
    expect(await processProject(project, "2026-W44", deps)).toBe("failed");
    expect(deps.markSent).not.toHaveBeenCalled();
    expect(await processProject(project, "2026-W44", deps)).toBe("sent");
    expect(deps.markSent).toHaveBeenCalledWith(project._id, "2026-W44");
  });

  it("skips an insufficient-data project with no events", async () => {
    const deps = dependencies({ runQuery: queryRows(0) });
    expect(await processProject(project, "2026-W44", deps)).toBe("skipped");
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("escapes hostile paths, names, and error messages in HTML", () => {
    const result = buildDigest({
      projectName: "<b>x</b>",
      week: "2026-W44",
      range: { from: "a", to: "b" },
      drift: { status: "ok", summary: "ok", metrics: [], topDecliners: [] },
      pages: [{ path: '/"><img src=x onerror=alert(1)>', views: 1, sessions: 1 }],
      clusters: [{ message: "<script>alert(1)</script>", occurrences: 1, affected_sessions: 1 }],
      unsubscribeUrl: "http://api.test/u",
    });
    expect(result.html).not.toMatch(/<img|<script|<b>x/);
    expect(result.html).toContain("&lt;");
  });

  it("rejects tampered unsubscribe tokens", () => {
    const token = signUnsubscribeToken("507f1f77bcf86cd799439011");
    expect(verifyUnsubscribeToken(token)).toBe("507f1f77bcf86cd799439011");
    expect(verifyUnsubscribeToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });

  it("rejects invented numbers and paths in LLM text", () => {
    const data = {
      drift: {
        status: "drop",
        summary: "s",
        metrics: [{ name: "sessions", cur: 75, prev: 100, deltaPct: -25 }],
        topDecliners: [],
      },
      pages: [{ path: "/pricing", views: 50, sessions: 20 }],
      clusters: [],
    };
    expect(groundingOk("Sessions fell 25% and /pricing has 50 views.", data)).toBe(true);
    expect(groundingOk("Sessions fell 99%.", data)).toBe(false);
    expect(groundingOk("Check /checkout.", data)).toBe(false);
  });

  it("falls back to the deterministic digest when an ungrounded LLM paragraph is rejected", async () => {
    const aiProject = { ...project, aiInsights: { enabled: true } };
    const deps = dependencies({
      llmConfigured: true,
      generateParagraph: jest.fn().mockRejectedValue(new Error("ungrounded paragraph")),
    });
    expect(await processProject(aiProject, "2026-W44", deps)).toBe("sent");
    expect(deps.sendEmail.mock.calls[0][0].text).not.toContain("What to fix");
  });

  it("does not log provider response text", async () => {
    const spy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const deps = dependencies();
    deps.sendEmail.mockRejectedValue(new Error("SECRET provider body"));
    await processProject(project, "2026-W44", deps);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET provider body");
    spy.mockRestore();
  });
});
