const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  apiKey: {
    type: String,
    index: true,
    unique: true,
    sparse: true,
  },
  apiKeyPrefix: {
    type : String,
    index : true,
  },
  apiKeyHash : {
    type : String,
    index : true,
    unique : true,
    sparse : true,
  },
  analyticsBackend : {
    type : String,
    enum : ["mongo","dual","clickhouse"],
    default : "dual",
  },
  analyticsBackendSince: { type: Date },
  supabaseUserId: {
    type: String,
    required: true,
  },  
  publicId: { type: String, index: true, unique: true, sparse: true },
  badge: {
    enabled: { type: Boolean, default: false },
    minCount: { type: Number, default: 3, min: 3, max: 999 },
  },
  // Attribution only (attacker-writable). Set at FIRST project creation. Never attach rewards to this.
  referredBy: { type: String, default: null },
  aiInsights: {
    enabled: { type: Boolean, default: false },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Project", ProjectSchema);
