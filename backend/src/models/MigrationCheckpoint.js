const mongoose = require("mongoose");

const MigrationCheckpointSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  lastProcessedId: { type: mongoose.Schema.Types.ObjectId },
  processedCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("MigrationCheckpoint", MigrationCheckpointSchema);
