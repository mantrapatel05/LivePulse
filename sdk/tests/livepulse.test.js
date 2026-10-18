import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sdkPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/livepulse.js");
const sdkSource = readFileSync(sdkPath, "utf8");

let fetchMock;

// Executes the SDK's source fresh against jsdom's real global window/document
// via indirect eval, guaranteeing a brand-new IIFE closure (and therefore
// fresh module-level state) every call -- Vite's dynamic-import analysis
// can't handle a fully-templated specifier, so this sidesteps that instead
// of fighting it.
function loadSdk() {
  delete window.LivePulse;
  // eslint-disable-next-line no-eval
  (0, eval)(sdkSource);
  return window.LivePulse;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style, script[data-lp-socketio]").forEach((el) => el.remove());
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "sendBeacon",
    vi.fn(() => true),
  );
  navigator.sendBeacon = vi.fn(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("init() without a consent config -- V1-compatible, ungated", () => {
  it("starts tracking immediately and sends a page_view on flush", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/v2/collect");
    expect(init.headers["x-api-key"]).toBe("lp_test");

    const body = JSON.parse(init.body);
    expect(body.schemaVersion).toBe(2);
    expect(body.events.some((e) => e.eventType === "page_view")).toBe(true);
  });

  it("reports consent state as n/a when consent was never configured", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    expect(LivePulse.getConsentState()).toBe("n/a");
  });
});

describe("init() with consent: 'pending' -- V2 consent gate", () => {
  it("does not track or send anything until consent is granted", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });
    LivePulse.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(LivePulse.getConsentState()).toBe("pending");
  });

  it("shows a consent banner with accept/decline", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });

    const banner = document.getElementById("lp-consent-banner");
    expect(banner).toBeTruthy();
    expect(banner.querySelector(".lp-accept")).toBeTruthy();
    expect(banner.querySelector(".lp-decline")).toBeTruthy();
  });

  it("granting consent starts tracking and removes the banner", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });

    LivePulse.consent("granted");
    expect(document.getElementById("lp-consent-banner")).toBeNull();
    expect(LivePulse.getConsentState()).toBe("granted");

    LivePulse.track("custom", { note: "hi" });
    LivePulse.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("declining consent means track() is a permanent no-op and nothing is queued", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });

    LivePulse.consent("denied");
    LivePulse.track("custom", { note: "should never be built" });
    LivePulse.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("__lp_retry_queue_v2") || "[]")).toHaveLength(0);
  });

  it("clicking Accept on the banner grants consent", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });

    document.getElementById("lp-consent-banner").querySelector(".lp-accept").click();
    expect(LivePulse.getConsentState()).toBe("granted");
  });
});

describe("Do Not Track", () => {
  it("forces denied even when the caller never configured consent at all", async () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(LivePulse.getConsentState()).toBe("denied");
  });

  it("does not show a banner -- the browser already answered the question", async () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });
    expect(document.getElementById("lp-consent-banner")).toBeNull();
  });
});

describe("batch envelope + transport", () => {
  it("posts a versioned envelope with schemaVersion, sentAt, and an events array", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.track("custom", { plan: "pro" });
    LivePulse.flush();

    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(body).toHaveProperty("schemaVersion", 2);
    expect(body).toHaveProperty("sentAt");
    expect(Array.isArray(body.events)).toBe(true);
    const custom = body.events.find((e) => e.eventType === "custom");
    expect(custom.properties).toEqual({ plan: "pro" });
    expect(custom.eventId).toBeTruthy();
    expect(custom.sessionId).toBeTruthy();
  });

  it("uses keepalive fetch with the API key header for sync flushes, never a query parameter", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.track("custom", {});

    document.dispatchEvent(new Event("visibilitychange"));
    // visibilitychange handler checks document.visibilityState, which
    // jsdom reports as "visible" by default -- exercise the sync path
    // directly via the public surface instead (beforeunload triggers it):
    window.dispatchEvent(new Event("beforeunload"));

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(url).toBe("http://api.test/api/v2/collect");
    expect(url).not.toContain("key=");
    expect(init.keepalive).toBe(true);
    expect(init.headers["x-api-key"]).toBe("lp_test");
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
    for (const [calledUrl, calledInit] of fetchMock.mock.calls) {
      expect(calledUrl).not.toContain("key=");
      expect(calledInit.headers["x-api-key"]).toBe("lp_test");
    }
  });
});

describe("PII sanitization", () => {
  it("redacts keys that look like PII from custom track() properties", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.track("custom", { userEmail: "a@b.com", plan: "pro" });
    LivePulse.flush();

    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    const custom = body.events.find((e) => e.eventType === "custom");
    expect(custom.properties.userEmail).toBe("[redacted]");
    expect(custom.properties.plan).toBe("pro");
  });

  it("honors a caller-provided property allowlist, dropping unlisted keys entirely", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", propertyAllowlist: ["plan"] });
    LivePulse.track("custom", { plan: "pro", internalDebugId: "x123" });
    LivePulse.flush();

    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    const custom = body.events.find((e) => e.eventType === "custom");
    expect(custom.properties).toEqual({ plan: "pro" });
  });
});

describe("bounded local retry with backoff", () => {
  it("persists to localStorage and retries after a failed send", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error("network down"));

    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test" });
    LivePulse.track("custom", {});
    LivePulse.flush();
    await vi.advanceTimersByTimeAsync(0); // let the rejected fetch promise settle

    const persisted = JSON.parse(localStorage.getItem("__lp_retry_queue_v2"));
    expect(persisted.length).toBeGreaterThan(0);

    fetchMock.mockResolvedValue({ ok: true, status: 202 });
    await vi.advanceTimersByTimeAsync(3000); // past the base retry delay
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("reset()", () => {
  it("clears the session id, retry queue, and re-shows the banner if consent was required", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending" });
    LivePulse.consent("granted");
    const firstSession = LivePulse.getSessionId();

    LivePulse.reset();

    expect(LivePulse.getSessionId()).not.toBe(firstSession);
    expect(document.getElementById("lp-consent-banner")).toBeTruthy();
    expect(LivePulse.getConsentState()).toBe("pending");
  });
});

describe("chat: opt-in independent of analytics consent", () => {
  it("renders the launcher but does not connect a socket until the panel is opened", async () => {
    const LivePulse = await loadSdk();
    LivePulse.init({ apiKey: "lp_test", endpoint: "http://api.test", consent: "pending", chat: true });

    // analytics consent still pending -- chat bubble exists regardless
    const launch = document.querySelector(".lp-launch");
    expect(launch).toBeTruthy();
    expect(document.querySelector('script[data-lp-socketio]')).toBeNull();

    launch.click(); // this click IS the chat opt-in
    expect(document.querySelector('script[data-lp-socketio]')).toBeTruthy();
  });
});

describe("one-tag auto-init", () => {
  it("reads data-key/data-api/data-chat/data-consent from document.currentScript", async () => {
    const fakeScript = document.createElement("script");
    fakeScript.dataset.key = "lp_from_tag";
    fakeScript.dataset.api = "http://tag.test";
    fakeScript.dataset.chat = "true";
    fakeScript.dataset.consent = "required";

    Object.defineProperty(document, "currentScript", { value: fakeScript, configurable: true });
    const LivePulse = loadSdk();
    Object.defineProperty(document, "currentScript", { value: null, configurable: true });

    expect(LivePulse.getConsentState()).toBe("pending");
    expect(document.getElementById("lp-consent-banner")).toBeTruthy();
    expect(document.querySelector(".lp-launch")).toBeTruthy(); // data-chat=true rendered the widget
  });

  it("without data-consent, auto-init falls back to ungated tracking", async () => {
    const fakeScript = document.createElement("script");
    fakeScript.dataset.key = "lp_from_tag";
    fakeScript.dataset.api = "http://tag.test";

    Object.defineProperty(document, "currentScript", { value: fakeScript, configurable: true });
    const LivePulse = loadSdk();
    Object.defineProperty(document, "currentScript", { value: null, configurable: true });

    LivePulse.flush();
    expect(fetchMock).toHaveBeenCalled();
  });
});
