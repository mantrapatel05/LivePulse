import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pulsePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend/public/pulse/pulse.js");
const pulseSource = readFileSync(pulsePath, "utf8");

let fetchMock;

function setCurrentScript(withPublicId = true) {
  const fakeScript = document.createElement("script");
  fakeScript.src = "https://api.test/pulse/pulse.js";
  if (withPublicId) fakeScript.dataset.publicId = "AbCdEfGhJkLm";
  Object.defineProperty(document, "currentScript", { value: fakeScript, configurable: true });
}

function loadPulse() {
  // eslint-disable-next-line no-eval
  (0, eval)(pulseSource);
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ mode: "live_now", count: 5 }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });
});

describe("standalone pulse script", () => {
  it("writes the live-now label to each target and fetches the public pulse endpoint", async () => {
    document.body.innerHTML = '<span data-lp-pulse></span><span data-lp-pulse></span>';
    setCurrentScript();
    loadPulse();
    await flushPromises();

    expect([...document.querySelectorAll("[data-lp-pulse]")].map((el) => el.textContent)).toEqual([
      "5 reading now",
      "5 reading now",
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/api/public/AbCdEfGhJkLm/pulse");
  });

  it("writes the visitors-today label", async () => {
    document.body.innerHTML = '<span data-lp-pulse></span>';
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ mode: "visitors_today", count: 12 }) });
    setCurrentScript();
    loadPulse();
    await flushPromises();

    expect(document.querySelector("[data-lp-pulse]").textContent).toBe("12 visitors today");
  });

  it("leaves host fallback text unchanged for brand_only", async () => {
    document.body.innerHTML = '<span data-lp-pulse>fallback</span>';
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ mode: "brand_only", count: 0 }) });
    setCurrentScript();
    loadPulse();
    await flushPromises();

    expect(document.querySelector("[data-lp-pulse]").textContent).toBe("fallback");
  });

  it("ignores hostile non-numeric counts without creating HTML", async () => {
    document.body.innerHTML = '<span data-lp-pulse>fallback</span>';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ mode: "live_now", count: "<img src=x onerror=alert(1)>" }),
    });
    setCurrentScript();
    loadPulse();
    await flushPromises();

    expect(document.querySelector("[data-lp-pulse]").textContent).toBe("fallback");
    expect(document.querySelector("img")).toBeNull();
  });

  it("swallows fetch rejection and leaves host text unchanged", async () => {
    document.body.innerHTML = '<span data-lp-pulse>fallback</span>';
    fetchMock.mockRejectedValue(new Error("network down"));
    setCurrentScript();
    expect(() => loadPulse()).not.toThrow();
    await flushPromises();

    expect(document.querySelector("[data-lp-pulse]").textContent).toBe("fallback");
  });

  it("leaves host text unchanged for a non-ok response", async () => {
    document.body.innerHTML = '<span data-lp-pulse>fallback</span>';
    fetchMock.mockResolvedValue({ ok: false });
    setCurrentScript();
    loadPulse();
    await flushPromises();

    expect(document.querySelector("[data-lp-pulse]").textContent).toBe("fallback");
  });

  it("does not fetch without a public id", () => {
    setCurrentScript(false);
    loadPulse();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays below the 2 KB size limit", () => {
    expect(readFileSync(pulsePath).length).toBeLessThan(2048);
  });
});
