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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Project", ProjectSchema);
