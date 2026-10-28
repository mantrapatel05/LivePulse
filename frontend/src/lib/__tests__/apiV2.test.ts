import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({
  getSupabase: vi.fn(),
}));

import { getSupabase } from "../supabaseClient";
import { analyticsV2, presetToRange } from "../apiV2";

function mockAuthedSupabase() {
  (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
        error: null,
      }),
    },
  });
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe("presetToRange", () => {
  it("last_hour spans exactly one hour ending now", () => {
    const { from, to } = presetToRange("last_hour");
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeCloseTo(60 * 60 * 1000, -2);
  });

  it("last_24h spans 24 hours", () => {
    const { from, to } = presetToRange("last_24h");
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -2);
  });

  it("last_7d spans 7 days", () => {
    const { from, to } = presetToRange("last_7d");
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeCloseTo(
      7 * 24 * 60 * 60 * 1000,
      -2,
    );
  });

  it("custom uses the exact caller-provided bounds", () => {
    const custom = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    };
    expect(presetToRange("custom", custom)).toEqual(custom);
  });
});

describe("analyticsV2 endpoint mapping", () => {
  beforeEach(() => {
    mockAuthedSupabase();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: [], generatedAt: "now", range: null })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const api = analyticsV2("proj-1");
  const from = "2026-01-01T00:00:00.000Z";
  const to = "2026-01-01T01:00:00.000Z";
  const tz = "UTC";

  it.each([
    ["overview", () => api.overview(from, to, tz), "/api/v2/projects/proj-1/overview"],
    ["timeseries", () => api.timeseries(from, to, tz), "/api/v2/projects/proj-1/timeseries"],
    ["topPages", () => api.topPages(from, to, tz), "/api/v2/projects/proj-1/top-pages"],
    [
      "eventBreakdown",
      () => api.eventBreakdown(from, to, tz),
      "/api/v2/projects/proj-1/event-breakdown",
    ],
    [
      "errorClusters",
      () => api.errorClusters(from, to, tz),
      "/api/v2/projects/proj-1/error-clusters",
    ],
    ["activeSessions", () => api.activeSessions(), "/api/v2/projects/proj-1/sessions?state=active"],
    [
      "historicalSessions",
      () => api.historicalSessions(from, to, tz),
      "/api/v2/projects/proj-1/sessions?state=historical",
    ],
    [
      "sessionTimeline",
      () => api.sessionTimeline("sess-1"),
      "/api/v2/projects/proj-1/sessions/sess-1/timeline",
    ],
    ["health", () => api.health(), "/api/v2/projects/proj-1/health"],
    ["engagementDrift", () => api.engagementDrift(), "/api/v2/projects/proj-1/engagement-drift"],
  ])("%s calls the correct v2 path", async (_label, call, expectedPath) => {
    await call();
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(expectedPath);
  });

  it("attaches from/to/timezone as query params for range-based endpoints", async () => {
    await api.overview(from, to, tz);
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain(`from=${encodeURIComponent(from)}`);
    expect(url).toContain(`to=${encodeURIComponent(to)}`);
    expect(url).toContain(`timezone=${tz}`);
  });

  it("attaches the Bearer session token, matching the dashboard trust boundary", async () => {
    await api.overview(from, to, tz);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("POSTs session and error-cluster insights with the Bearer token and range body", async () => {
    await api.explainSession("session/one");
    let [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/sessions/session%2Fone/insight");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");

    (fetch as unknown as ReturnType<typeof vi.fn>).mockClear();
    await api.explainErrorCluster("TypeError #", from, to, tz);
    [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/error-clusters/insight");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      signature: "TypeError #",
      from,
      to,
      timezone: tz,
    });
  });

  it("propagates the backend's error message on a non-2xx response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: "Project not found" }, false, 404),
    );
    await expect(api.overview(from, to, tz)).rejects.toThrow(/Project not found/);
  });
});
