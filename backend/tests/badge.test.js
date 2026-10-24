const request = require("supertest");
const app = require("../src/app");
const Event = require("../src/models/Event");
const Project = require("../src/models/Project");
const { connect, closeDatabase, clearDatabase } = require("./helpers/testDb");
const { makeToken } = require("./helpers/authToken");
const { getRedisClient } = require("../src/shared/redisClient");
const { touchSession } = require("../src/shared/activeSessionState");
const analyticsQueries = require("../src/shared/analyticsQueries");
const badge = require("../src/controllers/badgeController");

const auth = (uid) => ({ Authorization: `Bearer ${makeToken(uid)}` });
const ID_RE = /^[1-9A-HJ-NP-Za-km-z]{12}$/;

async function createProject(uid, extra = {}) {
  const res = await request(app).post("/api/projects").set(auth(uid)).send({ name: "Proj", ...extra });
  return res.body.project;
}

async function enable(uid, project, body = { enabled: true }) {
  return request(app).patch(`/api/projects/${project._id}/badge`).set(auth(uid)).send(body);
}

async function seedSessions(project, n) { // n distinct sessions today
  for (let i = 0; i < n; i++) {
    await Event.create({ projectId: project._id, sessionId: `s${i}`, eventType: "page_view", url: "https://x.test/" });
  }
}

async function seedLive(project, n) {
  const redis = getRedisClient();
  for (let i = 0; i < n; i++) await touchSession(redis, { projectId: String(project._id), sessionId: `live${i}`, url: "/" });
}

const svg = (publicId, headers = {}) => request(app).get(`/badge/${publicId}.svg`).set(headers);
const svgText = (res) => (Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.text);

beforeAll(connect);
beforeEach(async () => { await getRedisClient().flushall(); badge.__resetBadgeCaches(); });
afterEach(async () => { await clearDatabase(); jest.restoreAllMocks(); delete process.env.BADGE_RATE_LIMIT_PER_IP_PER_MIN; delete process.env.BADGE_BRAND_FLOOR; });
afterAll(closeDatabase);

describe("public badge and referral endpoints", () => {
  it("creates a project with a public id and default badge settings", async () => {
    const created = await createProject("u1");
    expect(created.publicId).toMatch(ID_RE);
    const project = await Project.findById(created._id).lean();
    expect(project.badge.enabled).toBe(false);
    expect(project.badge.minCount).toBe(3);
    expect(project.referredBy).toBeNull();
  });

  it("rejects an invalid id without querying Mongo", async () => {
    const findOne = jest.spyOn(Project, "findOne");
    const res = await request(app).get("/badge/aaaa.svg");
    expect(res.status).toBe(404);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("negative-caches an unknown valid-format id", async () => {
    const findOne = jest.spyOn(Project, "findOne");
    const first = await svg("AbCdEfGhJkLm");
    expect(first.status).toBe(404);
    expect(first.headers["cache-control"]).toBe("public, max-age=60");
    expect((await svg("AbCdEfGhJkLm")).status).toBe(404);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("keeps the badge disabled by default", async () => {
    const project = await createProject("u1");
    expect((await svg(project.publicId)).status).toBe(404);
  });

  it("validates badge patches, ownership, and projects without a public id", async () => {
    const project = await createProject("u1");
    expect((await enable("u1", project, { enabled: "yes" })).status).toBe(400);
    expect((await enable("u1", project, { minCount: 2 })).status).toBe(400);
    expect((await enable("u1", project, { minCount: 1000 })).status).toBe(400);
    expect((await enable("u1", project, { minCount: 3.5 })).status).toBe(400);
    expect((await enable("u1", project, { foo: 1 })).status).toBe(400);
    expect((await enable("u1", project, {})).status).toBe(400);
    expect((await enable("u2", project, { enabled: true })).status).toBe(404);

    const legacy = await Project.create({ name: "Legacy", supabaseUserId: "u1" });
    expect((await enable("u1", legacy, { enabled: true })).status).toBe(409);
  });

  it("enables the badge and sends the public SVG cache and security headers", async () => {
    const project = await createProject("u1");
    const patched = await enable("u1", project);
    expect(patched.status).toBe(200);
    expect(patched.body.project.badge.enabled).toBe(true);

    const res = await svg(project.publicId);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
    expect(res.headers["cache-control"]).toBe("public, max-age=30, s-maxage=30");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("shows brand-only content when there is no honest number to display", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const res = await svg(project.publicId);
    expect(svgText(res)).toContain("LIVEPULSE");
    expect(svgText(res)).toContain("realtime analytics");
    expect(svgText(res)).not.toContain("reading now");
    expect(svgText(res)).not.toContain("visitors today");
    expect(svgText(res)).not.toContain("Proj");
    expect(svgText(res)).not.toMatch(/lp_live_/);
  });

  it("shows today's visitors only when the brand floor is met", async () => {
    const enough = await createProject("u1");
    await enable("u1", enough);
    await seedSessions(enough, 3);
    expect(svgText(await svg(enough.publicId))).toContain("3 visitors today");

    const below = await createProject("u2");
    await enable("u2", below);
    await seedSessions(below, 2);
    expect(svgText(await svg(below.publicId))).toContain("realtime analytics");
  });

  it("shows live readers at the configured threshold, but not below it", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    await seedLive(project, 2);
    expect(svgText(await svg(project.publicId))).not.toContain("reading now");

    badge.__resetBadgeCaches();
    await touchSession(getRedisClient(), {
      projectId: String(project._id),
      sessionId: "live2",
      url: "/",
    });
    expect(svgText(await svg(project.publicId))).toContain("3 reading now");
  });

  it("enforces the brand floor even when a stored minimum is below 3", async () => {
    const project = await createProject("u1");
    await Project.updateOne({ _id: project._id }, { "badge.minCount": 1, "badge.enabled": true });
    badge.__resetBadgeCaches();
    await seedLive(project, 1);

    expect(svgText(await svg(project.publicId))).not.toContain("reading now");
  });

  it("returns the honest display ladder from the pulse JSON endpoint", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const res = await request(app).get(`/api/public/${project.publicId}/pulse`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["count", "mode", "publicId"]);
    expect(res.body).toEqual({ publicId: project.publicId, mode: "brand_only", count: 0 });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toBe("public, max-age=30, s-maxage=30");

    const disabled = await createProject("u2");
    expect((await request(app).get(`/api/public/${disabled.publicId}/pulse`)).status).toBe(404);
  });

  it("escapes XML and applies the expected count and display formatting", () => {
    const { escapeXml, formatCount, pickDisplay, buildSvg } = badge.__test;
    const escaped = escapeXml('<script>alert("x")&\'</script>');
    expect(escaped).not.toMatch(/[<>]/);
    expect(escaped).toContain("&lt;script&gt;");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(12345)).toBe("12.3k");
    expect(formatCount(-5)).toBe("0");
    expect(formatCount("abc")).toBe("0");
    expect(pickDisplay({ minCount: 3 }, { liveNow: 3, todayVisitors: 0 }).mode).toBe("live_now");
    expect(pickDisplay({ minCount: 3 }, { liveNow: 2, todayVisitors: 3 }).mode).toBe("visitors_today");
    expect(pickDisplay({ minCount: 3 }, { liveNow: 2, todayVisitors: 2 }).mode).toBe("brand_only");

    const svgText = buildSvg({ mode: "live_now", count: 5 });
    const textNodes = [...svgText.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1]);
    expect(svgText).toContain("LIVEPULSE");
    expect(svgText).toContain("5 reading now");
    expect(Number(/width="(\d+)"/.exec(svgText)[1])).toBeGreaterThanOrEqual(200);
    expect(textNodes.every((text) => !/[<>]/.test(text))).toBe(true);
  });

  it("counts distinct badge impression IPs in a daily HLL", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.1" });
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.2" });
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.3" });
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.1" });

    const key = `badge:imp:${project.publicId}:${badge.__test.dayKey()}`;
    const redis = getRedisClient();
    expect(await redis.pfcount(key)).toBe(3);
    expect(await redis.ttl(key)).toBeGreaterThan(7 * 86400);
  });

  it("records landing hits without revealing unknown or disabled projects", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const path = `/api/public/${project.publicId}/landing-hit`;
    const redis = getRedisClient();
    const key = `landing:ref:${project.publicId}:${badge.__test.dayKey()}`;
    await request(app).post(path).set("X-Forwarded-For", "10.0.0.1").expect(204);
    expect(await redis.pfcount(key)).toBe(1);
    await request(app).post(path).set("X-Forwarded-For", "10.0.0.1").expect(204);
    expect(await redis.pfcount(key)).toBe(1);
    await request(app).post(path).set("X-Forwarded-For", "10.0.0.2").expect(204);
    expect(await redis.pfcount(key)).toBe(2);

    const beforeUnknown = await redis.keys("landing:ref:*");
    await request(app).post("/api/public/AbCdEfGhJkLm/landing-hit").expect(204);
    expect(await redis.keys("landing:ref:*")).toEqual(beforeUnknown);
    await request(app).post("/api/public/invalid/landing-hit").expect(204);

    const disabled = await createProject("u2");
    await request(app).post(`/api/public/${disabled.publicId}/landing-hit`).expect(204);
    expect(await redis.exists(`landing:ref:${disabled.publicId}:${badge.__test.dayKey()}`)).toBe(0);
  });

  it("rate-limits badge requests by client IP", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    process.env.BADGE_RATE_LIMIT_PER_IP_PER_MIN = "3";

    const responses = [];
    for (let i = 0; i < 4; i++) {
      responses.push(await svg(project.publicId, { "X-Forwarded-For": "10.0.0.10" }));
    }
    expect(responses.slice(0, 3).map((res) => res.status)).toEqual([200, 200, 200]);
    expect(responses[3].status).toBe(429);
    expect(responses[3].headers["content-type"]).toMatch(/text\/plain/);
    expect(responses[3].headers["retry-after"]).toBeDefined();
    expect((await svg(project.publicId, { "X-Forwarded-For": "10.0.0.11" })).status).toBe(200);
  });

  it("caches counts and coalesces parallel badge requests", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const distinct = jest.spyOn(Event, "distinct");

    await Promise.all(Array.from({ length: 20 }, () => svg(project.publicId)));
    expect(distinct).toHaveBeenCalledTimes(1);
    await svg(project.publicId);
    expect(distinct).toHaveBeenCalledTimes(1);
    badge.__resetBadgeCaches();
    await svg(project.publicId);
    expect(distinct).toHaveBeenCalledTimes(2);
  });

  it("invalidates the public project cache immediately after disabling", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    expect((await svg(project.publicId)).status).toBe(200);
    expect((await enable("u1", project, { enabled: false })).status).toBe(200);
    expect((await svg(project.publicId)).status).toBe(404);
  });

  it("uses ClickHouse for today visitors when configured", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    await Project.updateOne({ _id: project._id }, { analyticsBackend: "clickhouse" });
    badge.__resetBadgeCaches();
    const runQuery = jest.spyOn(analyticsQueries, "runQuery").mockResolvedValue([{ visitors: "7" }]);
    const distinct = jest.spyOn(Event, "distinct");

    const res = await svg(project.publicId);
    expect(res.status).toBe(200);
    expect(svgText(res)).toContain("7 visitors today");
    expect(distinct).not.toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: expect.objectContaining({
          projectId: String(project._id),
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2} 00:00:00\.000$/),
        }),
      }),
      "badge_today_visitors",
    );
  });

  it("degrades to brand-only when the ClickHouse visitor query fails", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    await Project.updateOne({ _id: project._id }, { analyticsBackend: "clickhouse" });
    badge.__resetBadgeCaches();
    jest.spyOn(analyticsQueries, "runQuery").mockRejectedValue(new Error("ClickHouse unavailable"));

    const res = await svg(project.publicId);
    expect(res.status).toBe(200);
    expect(svgText(res)).toContain("realtime analytics");
  });

  it("returns owner-only badge stats with the daily funnel counts", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const day = badge.__test.dayKey();
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.1" });
    await svg(project.publicId, { "X-Forwarded-For": "10.0.0.2" });
    await request(app).post(`/api/public/${project.publicId}/landing-hit`).set("X-Forwarded-For", "10.0.0.3");
    await Project.create({ name: "Referred", supabaseUserId: "u2", referredBy: project.publicId });

    const res = await request(app).get(`/api/projects/${project._id}/badge`).set(auth("u1"));
    expect(res.status).toBe(200);
    expect(res.body.publicId).toBe(project.publicId);
    expect(res.body.badge).toEqual({ enabled: true, minCount: 3 });
    expect(res.body.today).toEqual({ impressions: 2, landingHits: 1 });
    expect(res.body.last7Days).toHaveLength(7);
    expect(res.body.last7Days[6]).toEqual({ day, impressions: 2, landingHits: 1 });
    expect(res.body.referralProjects).toBe(1);
    expect((await request(app).get(`/api/projects/${project._id}/badge`).set(auth("u2"))).status).toBe(404);

    const legacy = await Project.create({ name: "Legacy", supabaseUserId: "u3" });
    const empty = await request(app).get(`/api/projects/${legacy._id}/badge`).set(auth("u3"));
    expect(empty.body).toEqual({
      publicId: null,
      badge: { enabled: false, minCount: 3 },
      today: { impressions: 0, landingHits: 0 },
      last7Days: [],
      referralProjects: 0,
    });
  });

  it("stores only valid referrals on the user's first project", async () => {
    const referrer = await createProject("uA");
    const first = await createProject("uB", { referredBy: referrer.publicId });
    expect(first.referredBy).toBe(referrer.publicId);
    const stats = await request(app).get(`/api/projects/${referrer._id}/badge`).set(auth("uA"));
    expect(stats.body.referralProjects).toBe(1);

    const second = await createProject("uB", { referredBy: referrer.publicId });
    expect(second.referredBy).toBeNull();
    const unknown = await createProject("uC", { referredBy: "ZyXwVuTsRqPo" });
    expect(unknown.referredBy).toBeNull();
    const malformed = await createProject("uD", { referredBy: "not-an-id" });
    expect(malformed.referredBy).toBeNull();
  });

  it("uses wildcard public CORS without varying on Origin", async () => {
    const project = await createProject("u1");
    await enable("u1", project);
    const res = await svg(project.publicId).set("Origin", "https://customer.example");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers.vary).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();

    const preflight = await request(app)
      .options(`/api/public/${project.publicId}/landing-hit`)
      .set("Origin", "https://customer.example");
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers.vary).toBeUndefined();
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
