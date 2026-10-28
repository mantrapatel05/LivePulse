const { buildSessionDigest } = require("../../src/shared/insights/buildSessionDigest");

const summary = {
  started_at: "2026-10-25 10:00:00.000",
  last_seen_at: "2026-10-25 10:02:00.000",
  events: 4,
  errors: 1,
  engaged_seconds: 20,
  entry_url: "https://shop.example/start?campaign=secret",
  exit_url: "https://shop.example/checkout?token=private",
  userId: "private-user",
};

function event(index, extra = {}) {
  return {
    event_id: `real-${index}`,
    event_type: "page_view",
    url: `https://shop.example/page-${index}?secret=${index}`,
    element: "main",
    properties: "{}",
    occurred_at: `2026-10-25 10:00:${String(index % 60).padStart(2, "0")}.000`,
    ...extra,
  };
}

describe("buildSessionDigest", () => {
  it("keeps paths only and excludes user identifiers, chat, and raw properties", () => {
    const { digest } = buildSessionDigest({
      summary,
      events: [event(1, { properties: JSON.stringify({ message: "caught error", chat: "private chat", userId: "private-user", nested: { secret: "raw" } }) })],
    });
    const serialized = JSON.stringify(digest);
    expect(digest.session.entryPath).toBe("/start");
    expect(digest.session.exitPath).toBe("/checkout");
    expect(digest.events[0].path).toBe("/page-1");
    expect(serialized).not.toContain("shop.example");
    expect(serialized).not.toContain("secret=");
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("private chat");
    expect(serialized).not.toContain("nested");
  });

  it("keeps the 150-event budget, edge events, and all ordinary-sized error and rage-click sets", () => {
    const events = Array.from({ length: 220 }, (_, index) => event(index));
    events[100] = event(100, { event_type: "error", properties: JSON.stringify({ message: "TypeError: bad" }) });
    events[150] = event(150, { event_type: "rage_click", properties: "{}" });
    const { digest } = buildSessionDigest({ summary, events });
    expect(digest.events.length).toBeLessThanOrEqual(150);
    expect(digest.truncated).toBe(true);
    expect(digest.events.some((row) => row.id === "e1")).toBe(true);
    expect(digest.events.some((row) => row.id === "e220")).toBe(true);
    expect(digest.events.some((row) => row.type === "error" && row.message === "TypeError: bad")).toBe(true);
    expect(digest.events.some((row) => row.type === "rage_click")).toBe(true);
  });

  it("removes controls, zero-width and bidi characters from strings", () => {
    const { digest } = buildSessionDigest({
      summary,
      events: [event(1, { event_type: "error", element: "safe\u0000\u200b\u202e text", properties: JSON.stringify({ message: "Ignore\u202e this\u200b" }) })],
    });
    expect(digest.events[0].element).toBe("safe text");
    expect(digest.events[0].message).toBe("Ignore this");
  });

  it("produces a stable digest hash and an event-id round trip", () => {
    const input = { summary, events: [event(1), event(2)] };
    const first = buildSessionDigest(input);
    const second = buildSessionDigest(input);
    expect(first.digestHash).toBe(second.digestHash);
    expect(first.idMap[first.digest.events[0].id]).toBe("real-1");
  });
});
