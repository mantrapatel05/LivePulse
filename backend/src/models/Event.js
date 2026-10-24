const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Project",
    required: true,
  },
  // Optional for pre-migration V1 records; all new V2 writes persist this key.
  eventId: { type: String },
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    default: "anonymous",
    index: true,
  },
  eventType: {
    type: String,
    required: true,
    enum: ["page_view", "click", "error", "rage_click", "custom", "time_on_page", "scroll_depth", "identify"],
  },
  url: {
    type: String,
    required: true,
  },
  element: {
    type: String,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  city: {
    type: String,
  },
  receivedAt: {
    type: Date,
    default: Date.now,
  },
});

//ttl index(30 days)
EventSchema.index(
  { receivedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
  },
);

// Exclude legacy records that predate eventId while enforcing retry
// idempotency for all events accepted after the migration.
EventSchema.index(
  { projectId: 1, eventId: 1 },
  {
    unique: true,
    partialFilterExpression: { eventId: { $type: "string" } },
    name: "uniq_event_project_event_id",
  },
);

module.exports = mongoose.model("Event", EventSchema);
