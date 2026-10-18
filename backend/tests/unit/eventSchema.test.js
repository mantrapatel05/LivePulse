const {
  validateEnvelope,
  validateEvent,
  sanitizeProperties,
  normalizeUrl,
  SCHEMA_VERSION,
} = require("../../src/shared/eventSchema");
const { ValidationError } = require("../../src/shared/errors");

describe("validateEnvelope", () => {
  const base = { schemaVersion: SCHEMA_VERSION, sentAt: new Date().toISOString(), events: [{}] };

  it("accepts a well-formed envelope", () => {
    expect(validateEnvelope(base)).toBe(true);
  });

  it("rejects the wrong schemaVersion", () => {
    expect(() => validateEnvelope({ ...base, schemaVersion: 1 })).toThrow(ValidationError);
  });

  it("rejects a missing/invalid sentAt", () => {
    expect(() => validateEnvelope({ ...base, sentAt: "not-a-date" })).toThrow(/sentAt/);
  });

  it("rejects an empty or missing events array", () => {
    expect(() => validateEnvelope({ ...base, events: [] })).toThrow(/non-empty array/);
    expect(() => validateEnvelope({ ...base, events: undefined })).toThrow(/non-empty array/);
  });

  it("rejects a batch over the per-batch limit", () => {
    const tooMany = { ...base, events: new Array(501).fill({}) };
    expect(() => validateEnvelope(tooMany)).toThrow(/500-per-batch/);
  });
});

describe("validateEvent", () => {
  const good = { sessionId: "s1", eventType: "page_view", url: "https://example.com/pricing" };

  it("accepts a well-formed event and fills in defaults", () => {
    const { ok, event } = validateEvent(good, 0);
    expect(ok).toBe(true);
    expect(event.sessionId).toBe("s1");
    expect(event.userId).toBe("anonymous");
    expect(event.eventId).toBeTruthy(); // auto-generated when not supplied
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("preserves a caller-supplied eventId (needed for idempotent retries)", () => {
    const { event } = validateEvent({ ...good, eventId: "fixed-id-1" }, 0);
    expect(event.eventId).toBe("fixed-id-1");
  });

  it("preserves identify as a known event type for the Mongo event model", () => {
    const { ok, event } = validateEvent({ ...good, eventType: "identify" }, 0);
    expect(ok).toBe(true);
    expect(event.eventType).toBe("identify");
  });

  it("rejects missing sessionId / eventType / url", () => {
    expect(validateEvent({ ...good, sessionId: "" }, 0).ok).toBe(false);
    expect(validateEvent({ ...good, eventType: "" }, 0).ok).toBe(false);
    expect(validateEvent({ ...good, url: "" }, 0).ok).toBe(false);
  });

  it("never accepts an event explicitly marked consent=denied", () => {
    const { ok, error } = validateEvent({ ...good, consent: "denied" }, 0);
    expect(ok).toBe(false);
    expect(error).toMatch(/denied/);
  });

  it("falls back unknown event types to 'custom' rather than rejecting", () => {
    const { event } = validateEvent({ ...good, eventType: "totally_made_up" }, 0);
    expect(event.eventType).toBe("custom");
  });

  it("rejects an unparseable occurredAt/timestamp", () => {
    expect(validateEvent({ ...good, occurredAt: "not-a-date" }, 0).ok).toBe(false);
  });
});

describe("sanitizeProperties", () => {
  it("redacts keys that look like PII, case-insensitively", () => {
    const out = sanitizeProperties({ userEmail: "a@b.com", Password: "hunter2", ok: "fine" });
    expect(out.userEmail).toBe("[redacted]");
    expect(out.Password).toBe("[redacted]");
    expect(out.ok).toBe("fine");
  });

  it("caps string length", () => {
    const out = sanitizeProperties({ note: "x".repeat(1000) });
    expect(out.note.length).toBe(500);
  });

  it("caps object depth instead of recursing forever", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    const out = sanitizeProperties(deep);
    // depth 0=a,1=b,2=c already at MAX_PROPERTY_DEPTH(3) boundary -> d collapses
    expect(JSON.stringify(out)).not.toContain("too deep");
  });

  it("enforces an allowlist when provided — unlisted keys are dropped, not just redacted", () => {
    const out = sanitizeProperties({ plan: "pro", secretInternalField: "x" }, { allowlist: ["plan"] });
    expect(out).toEqual({ plan: "pro" });
  });

  it("caps the number of keys accepted", () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    const out = sanitizeProperties(many);
    expect(Object.keys(out).length).toBeLessThanOrEqual(40);
  });
});

describe("normalizeUrl", () => {
  it("strips the fragment/hash", () => {
    expect(normalizeUrl("https://example.com/pricing#section-2")).toBe(
      "https://example.com/pricing",
    );
  });

  it("falls back to a truncated raw string for an unparseable URL rather than throwing", () => {
    expect(() => normalizeUrl("not a url at all")).not.toThrow();
  });
});
