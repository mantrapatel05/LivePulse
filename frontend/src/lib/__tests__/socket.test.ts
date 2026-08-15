import { describe, expect, it } from "vitest";
import { normaliseEvent } from "../socket";

describe("normaliseEvent", () => {
  it("classifies error-shaped payloads as 'err'", () => {
    const row = normaliseEvent("new-event", { eventType: "error", message: "boom" });
    expect(row.kind).toBe("err");
    expect(row.label).toBe("boom");
  });

  it("classifies founder_message / user_reply as 'chat'", () => {
    expect(normaliseEvent("founder_message", { message: "hi" }).kind).toBe("chat");
    expect(normaliseEvent("user_reply", { message: "hi" }).kind).toBe("chat");
  });

  it("classifies page_view as 'view'", () => {
    const row = normaliseEvent("new-event", { eventType: "page_view", url: "/pricing" });
    expect(row.kind).toBe("view");
    expect(row.label).toBe("/pricing");
  });

  it("classifies click events as 'click'", () => {
    expect(normaliseEvent("new-event", { eventType: "click" }).kind).toBe("click");
  });

  it("falls back to 'other' for unrecognised event names", () => {
    expect(normaliseEvent("mystery-event", {}).kind).toBe("other");
  });

  it("extracts sessionId from either camelCase or snake_case", () => {
    expect(normaliseEvent("new-event", { sessionId: "abc" }).sessionId).toBe("abc");
    expect(normaliseEvent("new-event", { session_id: "xyz" }).sessionId).toBe("xyz");
  });

  it("truncates very long labels", () => {
    const row = normaliseEvent("new-event", { message: "x".repeat(500) });
    expect(row.label.length).toBe(160);
  });

  it("never throws on null/undefined payloads", () => {
    expect(() => normaliseEvent("disconnect", null)).not.toThrow();
    expect(() => normaliseEvent("disconnect", undefined)).not.toThrow();
  });
});
