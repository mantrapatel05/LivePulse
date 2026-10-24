require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Event = require("../src/models/Event");

async function run() {
  await connectDB();
  try {
    await Event.collection.createIndex(
      { projectId: 1, eventId: 1 },
      {
        unique: true,
        partialFilterExpression: { eventId: { $type: "string" } },
        name: "uniq_event_project_event_id",
      },
    );
    console.log("Mongo event idempotency index is ready.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("Failed to create Mongo event idempotency index:", err);
    process.exitCode = 1;
  });
}

module.exports = { run };
