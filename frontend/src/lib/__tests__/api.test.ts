import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({
  getSupabase: vi.fn(),
}));

import { getSupabase } from "../supabaseClient";
import {
  ApiError,
  createProject,
  getEmbedSnippet,
  listProjects,
  livepulseApi,
  rotateKey,
} from "../api";

function mockAuthedSupabase(token = "test-token") {
  (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: token } },
        error: null,
      }),
    },
  });
}

function mockUnauthedSupabase() {
  (getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  });
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("dashboard API client", () => {
  beforeEach(() => {
    mockAuthedSupabase();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ projects: [] })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the Supabase access token as a Bearer header on every dashboard call", async () => {
    await listProjects();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });

  it("throws a 401 ApiError instead of calling fetch when there is no session", async () => {
    mockUnauthedSupabase();
    await expect(listProjects()).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("unwraps { project } from createProject / rotateKey", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ project: { _id: "p1", name: "Acme", apiKey: "lp_x" } }),
    );
    const created = await createProject("Acme");
    expect(created).toEqual({ _id: "p1", name: "Acme", apiKey: "lp_x" });

    const rotated = await rotateKey("p1");
    expect(rotated._id).toBe("p1");
  });

  it("surfaces the backend's error message on a non-2xx response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: "Project not found" }, false, 404),
    );
    await expect(listProjects()).rejects.toThrow(/Project not found/);
  });

  it("wraps network failures in a clear ApiError instead of throwing a raw TypeError", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("fetch failed"));
    await expect(listProjects()).rejects.toBeInstanceOf(ApiError);
  });

  it("getEmbedSnippet hits the per-project embed endpoint", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ snippet: "<script></script>", backendOrigin: "http://x", apiKey: "lp_1" }),
    );
    await getEmbedSnippet("proj-9");
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/projects/proj-9/embed");
  });

  describe("livepulseApi endpoint mapping", () => {
    const api = livepulseApi("proj-42");

    it.each([
      [
        "activeSessions",
        () => api.activeSessions(5),
        "/api/sessions/proj-42/active?windowMinutes=5",
      ],
      ["overview", () => api.overview(), "/api/analytics/proj-42/overview"],
      ["topPages", () => api.topPages(), "/api/analytics/proj-42/top-pages"],
      ["breakdown", () => api.breakdown(), "/api/analytics/proj-42/event-breakdown"],
      ["errors", () => api.errors(), "/api/analytics/proj-42/error-clusters"],
      ["eventsOverTime", () => api.eventsOverTime(), "/api/analytics/proj-42/events-over-time"],
      [
        "sessionTimeline",
        () => api.sessionTimeline("sess-1"),
        "/api/analytics/proj-42/sessions/sess-1/timeline",
      ],
      ["chatHistory", () => api.chatHistory("sess-1"), "/api/chat/proj-42/sess-1/history"],
    ])("%s calls the correct backend path", async (_label, call, expectedPath) => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
      await call();
      const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain(expectedPath);
    });
  });
});
