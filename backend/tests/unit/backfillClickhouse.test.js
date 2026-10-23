const mongoose = require("mongoose");
const { deterministicEventId, toRow, checkpointKey, backfillQuery } = require("../../scripts/backfillClickhouse");

describe("backfillClickhouse", () => {
  it("scopes each checkpoint and query to the requested project", () => {
    const projectId = new mongoose.Types.ObjectId();
    const lastProcessedId = new mongoose.Types.ObjectId();

    expect(checkpointKey(projectId)).toBe(`backfill:clickhouse:${projectId}`);
    expect(backfillQuery(projectId, lastProcessedId)).toEqual({
      projectId,
      _id: { $gt: lastProcessedId },
    });
    expect(backfillQuery(projectId, null)).toEqual({ projectId });
  });

  it("derives the same event_id from the same Mongo _id every time (rerun safety)", () => {
    const id = new mongoose.Types.ObjectId();
    expect(deterministicEventId(id)).toBe(deterministicEventId(id));
    expect(deterministicEventId(id)).toBe(`mongo:${id.toString()}`);
  });

  it("different Mongo docs always produce different event_ids", () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    expect(deterministicEventId(a)).not.toBe(deterministicEventId(b));
  });

  it("toRow maps every events_v2 column and serializes properties/metadata as JSON", () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      sessionId: "s1",
      userId: "u1",
      eventType: "page_view",
      url: "https://example.com",
      element: null,
      city: "Berlin",
      metadata: { title: "Home" },
      timestamp: new Date("2026-01-01T12:00:00.000Z"),
    };

    const row = toRow(doc);
    expect(row.event_id).toBe(`mongo:${doc._id.toString()}`);
    expect(row.project_id).toBe(String(doc.projectId));
    expect(row.properties).toBe(JSON.stringify({ title: "Home" }));
    expect(row.occurred_at).toBe("2026-01-01 12:00:00.000");
  });

  it("defaults userId to 'anonymous' when the source doc has none", () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      sessionId: "s1",
      eventType: "page_view",
      url: "https://example.com",
      timestamp: new Date(),
    };
    expect(toRow(doc).user_id).toBe("anonymous");
  });
});
