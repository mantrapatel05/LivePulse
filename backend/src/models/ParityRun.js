const mongoose = require("mongoose");

const ParityRunSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  day: { type: String, required: true }, // "YYYY-MM-DD" UTC
  withinThreshold: { type: Boolean, required: true },
  report: { type: mongoose.Schema.Types.Mixed },
  ranAt: { type: Date, default: Date.now },
});

ParityRunSchema.index({ projectId: 1, day: 1 }, { unique: true });

module.exports = mongoose.model("ParityRun", ParityRunSchema);
