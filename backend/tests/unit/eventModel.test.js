const mongoose = require("mongoose");
const Event = require("../../src/models/Event");

describe("Event model", () => {
  it("accepts identify events produced by the batch ingestion schema", async () => {
    const event = new Event({
      projectId: new mongoose.Types.ObjectId(),
      sessionId: "session-1",
      eventType: "identify",
      url: "https://example.test/",
    });

    await expect(event.validate()).resolves.toBeUndefined();
  });

  it("continues rejecting event types outside the supported set", async () => {
    const event = new Event({
      projectId: new mongoose.Types.ObjectId(),
      sessionId: "session-1",
      eventType: "unsupported",
      url: "https://example.test/",
    });

    await expect(event.validate()).rejects.toMatchObject({
      errors: { eventType: expect.any(Object) },
    });
  });
});
