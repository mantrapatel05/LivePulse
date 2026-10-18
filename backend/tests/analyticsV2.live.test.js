// Opt-in integration test for actual MongoDB, Redis, and ClickHouse services.
// Run with LIVE_ANALYTICS_V2=1 and the service URLs configured in the environment.
const enabled = process.env.LIVE_ANALYTICS_V2 === "1";
const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("V2 analytics against live services", () => {
  let mongoose;
  let Project;
  let app;
  let server;
  let baseUrl;
  let token;
  let project;
  let redis;
  let closeSharedRedisClient;
  let clickhouse;
  let projectId;
  const userId = `live-v2-${Date.now()}`;
  const sessionId = `live-session-${Date.now()}`;
  const jwt = require("jsonwebtoken");

  beforeAll(async () => {
    if (!process.env.MONGO_URI || !process.env.REDIS_URL || !process.env.CLICKHOUSE_URL || !process.env.SUPABASE_JWT_SECRET) {
      throw new Error("Set MONGO_URI, REDIS_URL, CLICKHOUSE_URL, and SUPABASE_JWT_SECRET for live integration.");
    }
    mongoose = require("mongoose");
    Project = require("../src/models/Project");
    app = require("../src/app");
    const { getRedisClient, closeRedisClient } = require("../src/shared/redisClient");
    const { getClickhouseClient, runMigrations } = require("../src/shared/clickhouseClient");
    const { touchSession } = require("../src/shared/activeSessionState");
    redis = getRedisClient();
    closeSharedRedisClient = closeRedisClient;
    clickhouse = getClickhouseClient();

    await mongoose.connect(process.env.MONGO_URI);
    await runMigrations();
    project = await Project.create({
      name: `Live V2 integration ${Date.now()}`,
      supabaseUserId: userId,
      analyticsBackend: "clickhouse",
    });
    projectId = String(project._id);
    token = jwt.sign({ sub: userId, role: "authenticated" }, process.env.SUPABASE_JWT_SECRET, { algorithm: "HS256" });

    const now = new Date();
    const timestamps = [-120000, -60000, -1000].map((offset) =>
      new Date(now.getTime() + offset).toISOString().replace("T", " ").replace("Z", ""),
    );
    await clickhouse.insert({
      table: "events_v2",
      format: "JSONEachRow",
      values: [
        { project_id: projectId, event_id: `${sessionId}-page`, session_id: sessionId, event_type: "page_view", url: "https://example.test/", properties: "{}", occurred_at: timestamps[0] },
        { project_id: projectId, event_id: `${sessionId}-error`, session_id: sessionId, event_type: "error", url: "https://example.test/", properties: JSON.stringify({ message: "Live failure 731" }), occurred_at: timestamps[1] },
        { project_id: projectId, event_id: `${sessionId}-time`, session_id: sessionId, event_type: "time_on_page", url: "https://example.test/", properties: JSON.stringify({ seconds: 21 }), occurred_at: timestamps[2] },
      ],
    });
    await touchSession(redis, { projectId, sessionId: `active-${sessionId}`, url: "https://example.test/live", userId });

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 60000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (projectId && clickhouse) {
      for (const table of ["events_v2", "event_minute_agg_v2", "session_summary_v2", "error_clusters_v2"]) {
        try {
          await clickhouse.command({ query: `ALTER TABLE ${table} DELETE WHERE project_id = {projectId:String}`, query_params: { projectId } });
        } catch {}
      }
    }
    if (project?._id && Project) await Project.deleteOne({ _id: project._id });
    if (closeSharedRedisClient) await closeSharedRedisClient().catch(() => {});
    if (clickhouse) await clickhouse.close().catch(() => {});
    if (mongoose?.connection?.readyState) await mongoose.disconnect();
  }, 60000);

  async function get(path) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.generatedAt).toBeTruthy();
    return body;
  }

  it("reads every V2 dashboard resource from ClickHouse and Redis", async () => {
    const from = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 1000).toISOString();
    const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timezone=UTC`;

    const overview = await get(`/api/v2/projects/${projectId}/overview?${range}`);
    expect(overview.data).toMatchObject({ totalEvents: 3, uniqueVisitors: 1, errors: 1, activeNow: 1 });
    expect(overview.data.avgEngagedSeconds).toBe(21);

    const timeseries = await get(`/api/v2/projects/${projectId}/timeseries?${range}&interval=minute`);
    expect(timeseries.data.reduce((sum, row) => sum + row.count, 0)).toBe(3);

    const pages = await get(`/api/v2/projects/${projectId}/top-pages?${range}`);
    expect(pages.data).toEqual([expect.objectContaining({ path: "/", views: 1, sessions: 1 })]);

    const breakdown = await get(`/api/v2/projects/${projectId}/event-breakdown?${range}`);
    expect(breakdown.data.reduce((sum, row) => sum + row.count, 0)).toBe(3);

    const errors = await get(`/api/v2/projects/${projectId}/error-clusters?${range}`);
    expect(errors.data).toEqual([expect.objectContaining({ message: "Live failure 731", occurrences: 1, affected_sessions: 1 })]);

    const active = await get(`/api/v2/projects/${projectId}/sessions?state=active`);
    expect(active.data).toEqual([expect.objectContaining({ sessionId: `active-${sessionId}`, userId })]);

    const historical = await get(`/api/v2/projects/${projectId}/sessions?state=historical&${range}`);
    expect(historical.data).toEqual([expect.objectContaining({ session_id: sessionId, events: 3, errors: 1, engaged_seconds: 21 })]);

    const timeline = await get(`/api/v2/projects/${projectId}/sessions/${sessionId}/timeline`);
    expect(timeline.data).toMatchObject({ sessionId, eventCount: 3, errorCount: 1, events: expect.arrayContaining([expect.objectContaining({ event_type: "error" })]) });

    const health = await get(`/api/v2/projects/${projectId}/health`);
    expect(health.data).toMatchObject({ analyticsBackend: "clickhouse", redisOk: true, clickhouseOk: true, liveNow: 1 });
  });
});
