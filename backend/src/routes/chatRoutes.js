const express = require("express");
const router = express.Router();

const { getChatHistory } = require("../controllers/chatController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");

router.get(
  "/:projectId/:sessionId/history",
  requireDashboardAuth,
  requireProjectOwnership,
  getChatHistory,
);

module.exports = router;
