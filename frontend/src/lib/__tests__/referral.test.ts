import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferralFromUrl, clearReferral, peekReferral } from "../referral";

const KEY = "lp_referral";
const ID = "AbCdEfGhJkLm";

describe("referral storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("captures and stores a valid badge referral", () => {
    expect(captureReferralFromUrl(`?ref=badge&p=${ID}`)).toBe(ID);
    expect(peekReferral()).toBe(ID);
  });

  it.each([
    "?ref=other&p=AbCdEfGhJkLm",
    "?ref=badge",
    "?ref=badge&p=AbCdEfGhJkL",
    "?ref=badge&p=AbCdEfGhJkL0",
  ])("ignores invalid referral URL %s", (search) => {
    expect(captureReferralFromUrl(search)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("expires the referral after 30 days and removes the key", () => {
    vi.useFakeTimers();
    captureReferralFromUrl(`?ref=badge&p=${ID}`);
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

    expect(peekReferral()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears the stored referral", () => {
    captureReferralFromUrl(`?ref=badge&p=${ID}`);
    clearReferral();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("uses the most recently captured referral", () => {
    captureReferralFromUrl("?ref=badge&p=AbCdEfGhJkLm");
    captureReferralFromUrl("?ref=badge&p=ZyXwVuTsRqPo");
    expect(peekReferral()).toBe("ZyXwVuTsRqPo");
  });

  it("does not throw when localStorage writes are blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(() => captureReferralFromUrl(`?ref=badge&p=${ID}`)).not.toThrow();
    expect(captureReferralFromUrl(`?ref=badge&p=${ID}`)).toBe(ID);
  });
});
